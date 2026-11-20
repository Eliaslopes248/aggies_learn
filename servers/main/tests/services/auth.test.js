import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

import { RedisService } from "../../dist/database/redis.service.js";
import { signAccessToken, verifyAccessToken } from "../../dist/middleware/jwt.middleware.js";
import { AuthService, refreshTtlSeconds } from "../../dist/services/auth.service.js";
import { hashPassword, verifyPassword } from "../../dist/services/password.utils.js";

const student = {
    id: "10", email: "student@example.test", firstName: "Avery", lastName: "Reed",
    emailVerifiedAt: null, createdAt: "2026-11-19T00:00:00.000000Z",
};
const password = "example-passphrase";

beforeEach(() =>
{
    jest.replaceProperty(process, "env", { ...process.env, JWT_SECRET: "a".repeat(64) });
});

afterEach(() =>
{
    jest.restoreAllMocks();
    jest.useRealTimers();
});

describe("Access tokens", () =>
{
    test("preserve the session identity and expire after 1,000 seconds", () =>
    {
        jest.useFakeTimers({ now: new Date("2026-11-19T12:00:00Z") });
        const identity = { accountId: "10", sessionId: "example-session", roles: ["student"] };
        const token = signAccessToken(identity);

        // Check both sides of the expiry boundary without waiting
        jest.advanceTimersByTime(999_000);
        expect(verifyAccessToken(token)).toEqual(identity);
        jest.advanceTimersByTime(1000);
        expect(() => verifyAccessToken(token)).toThrow("jwt expired");
    });

    test("reject a token signed with another secret", () =>
    {
        const token = signAccessToken({ accountId: "10", sessionId: "example-session", roles: ["student"] });
        process.env.JWT_SECRET = "b".repeat(64);

        expect(() => verifyAccessToken(token)).toThrow("invalid signature");
    });
});

describe("Auth service", () =>
{
    test("registers a student with a password hash and returns a redacted profile", async () =>
    {
        const accounts = {
            createAccount: jest.fn(async input => ({ ...student, ...input })),
        };
        const auth = new AuthService(accounts, {}, {
            redisEnabled: false, campusEmailDomain: "example.test",
        });

        const result = await auth.registerStudent({
            email: " STUDENT@example.test ", firstName: " Avery ", lastName: " Reed ", password,
        });

        expect(accounts.createAccount).toHaveBeenCalledWith({
            email: student.email, firstName: "Avery", lastName: "Reed",
            passwordHash: expect.stringMatching(/^scrypt:32768:8:3:/),
        }, ["student"]);
        expect(result.profile).not.toHaveProperty("passwordHash");
        expect(verifyAccessToken(result.accessToken).roles).toEqual(["student"]);
    });

    test("rejects a registration outside the configured campus domain", async () =>
    {
        const accounts = { createAccount: jest.fn() };
        const auth = new AuthService(accounts, {}, {
            redisEnabled: false, campusEmailDomain: "example.test",
        });

        await expect(auth.registerStudent({ ...student, email: "user@other.test", password }))
            .rejects.toMatchObject({ status: 400 });
        expect(accounts.createAccount).not.toHaveBeenCalled();
    });

    test("rejects the wrong password and uses current roles at login", async () =>
    {
        const passwordHash = await hashPassword(password);
        const accounts = {
            findAccountByEmail: jest.fn().mockResolvedValue({ ...student, passwordHash }),
            listRoles: jest.fn().mockResolvedValue(["student", "tutor"]),
        };
        const auth = new AuthService(accounts, {}, { redisEnabled: false });

        await expect(auth.login(student.email, "wrong-password")).rejects.toMatchObject({ status: 401 });
        expect(accounts.listRoles).not.toHaveBeenCalled();

        const result = await auth.login(" STUDENT@example.test ", password);
        expect(accounts.findAccountByEmail).toHaveBeenLastCalledWith(student.email);
        expect(verifyAccessToken(result.accessToken).roles).toEqual(["student", "tutor"]);
    });

    test("rotates refresh tokens once and preserves the original session expiry", async () =>
    {
        // Use one in-memory value to simulate the Redis session record
        let stored;
        const setKey = jest.spyOn(RedisService, "setKey").mockImplementation(async (_key, value) =>
        {
            stored = value;
        });
        jest.spyOn(RedisService, "getKey").mockImplementation(async () => stored);
        jest.spyOn(RedisService, "replaceKey").mockImplementation(async (_key, expected, next) =>
        {
            if (stored !== expected)
            {
                return false;
            }

            stored = next;
            return true;
        });
        jest.spyOn(RedisService, "deleteMatchingKey").mockImplementation(async (_key, expected) =>
        {
            if (stored === expected)
            {
                stored = null;
            }
        });

        const accounts = {
            findAccountByEmail: jest.fn().mockResolvedValue({ ...student, passwordHash: await hashPassword(password) }),
            listRoles: jest.fn().mockResolvedValueOnce(["student"]).mockResolvedValue(["tutor"]),
        };
        const auth = new AuthService(accounts, {}, { redisEnabled: true });
        const session = await auth.login(student.email, password);
        const [sessionId, token] = session.refreshToken.split(".");

        expect(setKey).toHaveBeenCalledWith(`auth:sessions:${sessionId}`, {
            accountId: student.id, tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
            expiresAt: session.refreshExpiresAt,
        }, refreshTtlSeconds);
        expect(stored.tokenHash).not.toBe(token);

        // Start both refresh requests with the same original token
        const attempts = await Promise.allSettled([
            auth.refresh(session.refreshToken), auth.refresh(session.refreshToken),
        ]);
        const successes = attempts.filter(result => result.status === "fulfilled");
        expect(successes).toHaveLength(1);
        expect(attempts.find(result => result.status === "rejected").reason).toMatchObject({ status: 401 });

        const rotated = successes[0].value;
        expect(rotated.refreshExpiresAt).toBe(session.refreshExpiresAt);
        expect(rotated.refreshToken).not.toBe(session.refreshToken);
        expect(verifyAccessToken(rotated.accessToken).roles).toEqual(["tutor"]);

        await auth.logout(rotated.refreshToken);
        await expect(auth.refresh(rotated.refreshToken)).rejects.toMatchObject({ status: 401 });
    });

    test("requires the current password to change email and returns an unverified profile", async () =>
    {
        const account = { ...student, emailVerifiedAt: student.createdAt, passwordHash: await hashPassword(password) };
        const accounts = {
            findAccountById: jest.fn().mockResolvedValue(account),
            listRoles: jest.fn().mockResolvedValue(["student"]),
            updateProfile: jest.fn().mockResolvedValue(true),
        };
        const users = { invalidateProfile: jest.fn().mockResolvedValue(undefined) };
        const auth = new AuthService(accounts, users, { redisEnabled: false });
        const changes = { firstName: "Avery", lastName: "Brooks", email: "New@Example.test" };

        await expect(auth.updateProfile(student.id, changes)).rejects.toMatchObject({ status: 403 });
        expect(accounts.updateProfile).not.toHaveBeenCalled();

        const updated = await auth.updateProfile(student.id, { ...changes, currentPassword: password });
        expect(updated).toMatchObject({ lastName: "Brooks", email: "new@example.test", emailVerifiedAt: null });
        expect(updated).not.toHaveProperty("passwordHash");
        expect(users.invalidateProfile).toHaveBeenCalledWith(student.id);
    });

    test("emails a generated student password and restores the old hash on delivery failure", async () =>
    {
        const account = { ...student, emailVerifiedAt: student.createdAt, passwordHash: await hashPassword(password) };
        const accounts = {
            findAccountById: jest.fn().mockResolvedValue(account),
            listRoles: jest.fn().mockResolvedValue(["student"]),
            updateStudentPassword: jest.fn().mockResolvedValue(true),
        };
        const mail = { send: jest.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("SMTP down")) };
        const auth = new AuthService(accounts, {}, { redisEnabled: false, mail });

        await auth.changeStudentPassword(student.id);
        const message = mail.send.mock.calls[0][0];
        const generatedPassword = message.text.split("\n")[0].split(" ").at(-1);
        const firstHash = accounts.updateStudentPassword.mock.calls[0][1];
        expect(message.to).toBe(student.email);
        expect(await verifyPassword(generatedPassword, firstHash)).toBe(true);

        await expect(auth.changeStudentPassword(student.id)).rejects.toMatchObject({ status: 502 });
        const secondHash = accounts.updateStudentPassword.mock.calls[1][1];
        expect(accounts.updateStudentPassword).toHaveBeenLastCalledWith({ ...account, passwordHash: secondHash }, account.passwordHash);
    });

    test("emails a short-lived verification token and accepts it only once", async () =>
    {
        const setKey = jest.spyOn(RedisService, "setKey").mockResolvedValue(undefined);
        const takeKey = jest.spyOn(RedisService, "takeKey")
            .mockResolvedValueOnce({ id: student.id, email: student.email }).mockResolvedValueOnce(null);
        const accounts = { findAccountById: jest.fn().mockResolvedValue(student) };
        const users = { markEmailVerified: jest.fn().mockResolvedValue(true) };
        const mail = { send: jest.fn().mockResolvedValue(undefined) };
        const auth = new AuthService(accounts, users, {
            redisEnabled: true, mail, verificationURL: "https://example.test/verify",
        });

        await auth.sendVerification(student.id);
        const message = mail.send.mock.calls[0][0];
        const token = new URL(message.text.split(" ").at(-1)).searchParams.get("token");
        const key = setKey.mock.calls[0][0];

        expect(message.to).toBe(student.email);
        expect(key).toMatch(/^auth:email-verification:[a-f0-9]{64}$/);
        expect(key).not.toContain(token);
        expect(setKey).toHaveBeenCalledWith(key, { id: student.id, email: student.email }, 1800);
        await auth.verifyEmail(token);
        await expect(auth.verifyEmail(token)).rejects.toMatchObject({ status: 400 });
        expect(takeKey).toHaveBeenCalledWith(key);
        expect(users.markEmailVerified).toHaveBeenCalledTimes(1);
    });
});
