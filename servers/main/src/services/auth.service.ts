// Copyright 2026, Elias Lopes
// All rights reserved.
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are
// met:
//
//     * Redistributions of source code must retain the above copyright
// notice, this list of conditions and the following disclaimer.
//     * Redistributions in binary form must reproduce the above
// copyright notice, this list of conditions and the following disclaimer
// in the documentation and/or other materials provided with the
// distribution.
//     * Neither the name of Elias Lopes nor the names of its
// contributors may be used to endorse or promote products derived from
// this software without specific prior written permission.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
// "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
// LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS
// FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE
// COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT,
// INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING,
// BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
// LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
// CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
// LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN
// ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
// POSSIBILITY OF SUCH DAMAGE.

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import { type Account, type AccountProfile, type AccountRole } from "../database/models/users.model.js";
import { RedisService } from "../database/redis.service.js";
import { type IUserRepository, type ProfileChanges } from "../database/repositories/interfaces/users.interface.js";
import { getJWTSecret, signAccessToken } from "../middleware/jwt.middleware.js";
import { type EmailProvider } from "./email-delivery.service.js";
import { hashPassword, verifyPassword } from "./password.utils.js";
import { requireId, requireText, ServiceError } from "./service.utils.js";
import { toUserProfile, type UserService } from "./users.service.js";

export const refreshTtlSeconds = 7 * 24 * 60 * 60;
const verificationTtlSeconds = 30 * 60;
const opaqueTokenPattern = /^[a-f0-9]{64}$/;

type Registration = { email: string; firstName: string; lastName: string; password: string };
type ProfileInput = Omit<Registration, "password"> & { currentPassword?: string; newPassword?: string };
type VerificationTarget = Pick<Account, "id" | "email">;
type RefreshSession = { accountId: string; tokenHash: string; expiresAt: number };

type AuthOptions = {
    redisEnabled: boolean;
    campusEmailDomain?: string | undefined;
    verificationURL?: string | undefined;
    mail?: EmailProvider | undefined;
};

/**
 * Hash an opaque token before storing it in Redis.
 * @param token Opaque refresh or verification token.
 * @returns SHA-256 hash of the token.
 */
function hashToken(token: string): string
{
    return createHash("sha256").update(token).digest("hex");
}

/**
 * Create an opaque token from cryptographically random bytes.
 * @returns Random token encoded as hexadecimal.
 */
function createOpaqueToken(): string
{
    return randomBytes(32).toString("hex");
}

export class AuthService
{
    /**
     * Create the auth service with accounts, profiles, and session settings.
     * @param accounts Repository used to read and write accounts.
     * @param users User service used to record email verification.
     * @param options Redis, campus email, and mail settings.
     */
    constructor(
        private readonly accounts: IUserRepository,
        private readonly users: UserService,
        private readonly options: AuthOptions,
    ) {}

    /**
     * Create a student account and an authenticated session.
     * @param input Student name, email address, and password.
     * @returns Student profile and session tokens.
     */
    async registerStudent(input: Registration)
    {
        getJWTSecret();
        const email = requireText(input.email, 254, "Email").toLowerCase();
        const domain = this.options.campusEmailDomain?.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || (domain && email.split("@")[1] !== domain))
        {
            throw new ServiceError(400, "Enter a valid email address for student registration.");
        }

        const firstName = requireText(input.firstName, 150, "First name");
        const lastName = requireText(input.lastName, 150, "Last name");
        const passwordHash = await hashPassword(input.password);
        let account: Account;
        try
        {
            account = await this.accounts.createAccount({ email, firstName, lastName, passwordHash }, ["student"]);
        }
        catch (error)
        {
            if ((error as NodeJS.ErrnoException)?.code === "ER_DUP_ENTRY")
            {
                throw new ServiceError(409, "An account already exists for that email.");
            }

            throw error;
        }

        // Let users request another verification link if delivery fails
        if (this.options.redisEnabled && this.options.mail && this.options.verificationURL)
        {
            await this.sendVerification(account.id).catch(error =>
            {
                console.error("Unable to send verification email:", error);
            });
        }

        return { profile: toUserProfile(account), ...await this.startSession(account.id, ["student"]) };
    }

    /**
     * Save the signed-in account's profile and require its password for credential changes.
     * @param accountId Signed-in account ID.
     * @param input Submitted names, email, and optional password change.
     * @returns Updated profile and current roles.
     */
    async updateProfile(accountId: string, input: ProfileInput): Promise<AccountProfile & { roles: AccountRole[] }>
    {
        const id = requireId(accountId);
        const account = await this.accounts.findAccountById(id);
        if (!account)
        {
            throw new ServiceError(404, "Account not found.");
        }

        const changes: ProfileChanges = {
            firstName: requireText(input.firstName, 150, "First name"),
            lastName: requireText(input.lastName, 150, "Last name"),
            email: requireText(input.email, 254, "Email").toLowerCase(),
        };
        const roles = await this.accounts.listRoles(id);
        const emailChanged = changes.email !== account.email;
        const newPassword = input.newPassword;
        const passwordChanged = newPassword !== undefined && newPassword !== "";
        if (emailChanged)
        {
            const domain = this.options.campusEmailDomain?.trim().toLowerCase();
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(changes.email) ||
                (roles.includes("student") && domain && changes.email.split("@")[1] !== domain))
            {
                throw new ServiceError(400, "Enter a valid email address for your account.");
            }
        }

        if ((emailChanged || passwordChanged) && !await verifyPassword(input.currentPassword ?? "", account.passwordHash))
        {
            throw new ServiceError(403, "Enter your correct current password to change your email or password.");
        }

        if (passwordChanged)
        {
            changes.passwordHash = await hashPassword(newPassword);
        }

        try
        {
            if (!await this.accounts.updateProfile(account, changes))
            {
                throw new ServiceError(409, "Your account changed. Reload the profile and try again.");
            }
        }
        catch (error)
        {
            if ((error as NodeJS.ErrnoException)?.code === "ER_DUP_ENTRY")
            {
                throw new ServiceError(409, "An account already exists for that email.");
            }

            throw error;
        }

        await this.users.invalidateProfile(id);
        if (emailChanged && this.options.redisEnabled && this.options.mail && this.options.verificationURL)
        {
            await this.sendVerification(id).catch(() => undefined);
        }

        const profile = toUserProfile(account);
        return {
            ...profile,
            firstName: changes.firstName,
            lastName: changes.lastName,
            email: changes.email,
            emailVerifiedAt: emailChanged ? null : profile.emailVerifiedAt,
            roles,
        };
    }

    /**
     * Set a student's password or generate one and deliver it to a verified address.
     * @param studentId Student account ID.
     * @param password Admin-supplied password. An omitted password requests an emailed reset.
     */
    async changeStudentPassword(studentId: string, password?: string): Promise<void>
    {
        const id = requireId(studentId);
        const account = await this.accounts.findAccountById(id);
        if (!account || !(await this.accounts.listRoles(id)).includes("student"))
        {
            throw new ServiceError(404, "Student account not found.");
        }

        const mail = this.options.mail;
        const emailReset = password === undefined;
        if (emailReset && !mail)
        {
            throw new ServiceError(503, "Password reset email is unavailable.");
        }

        if (emailReset && !account.emailVerifiedAt)
        {
            throw new ServiceError(409, "The student must verify their email before an emailed reset.");
        }

        const nextPassword = emailReset ? randomBytes(24).toString("base64url") : password;
        const passwordHash = await hashPassword(nextPassword);
        if (!await this.accounts.updateStudentPassword(account, passwordHash))
        {
            throw new ServiceError(409, "The student's account changed. Reload it and try again.");
        }

        if (emailReset && mail)
        {
            try
            {
                await mail.send({
                    to: account.email,
                    subject: "Your Aggies Learn password was reset",
                    text: `Your new password is ${nextPassword}\n\nSign in, then open Account to choose a new password.`,
                });
            }
            catch
            {
                // Restore the previous password only if another change has not replaced the reset.
                const restored = await this.accounts.updateStudentPassword({ ...account, passwordHash }, account.passwordHash);
                throw new ServiceError(502, restored
                    ? "The reset email could not be sent. The previous password was restored."
                    : "The reset email could not be sent and the account changed. Reload it before trying again.");
            }
        }
    }

    /**
     * Authenticate an account and load its current roles.
     * @param email Email address used to sign in.
     * @param password Password supplied by the account holder.
     * @returns Account profile and session tokens.
     */
    async login(email: string, password: string)
    {
        const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
        const account = normalizedEmail && normalizedEmail.length <= 254
            ? await this.accounts.findAccountByEmail(normalizedEmail)
            : null;
        if (!await verifyPassword(password, account?.passwordHash) || !account)
        {
            throw new ServiceError(401, "Invalid email or password.");
        }

        const roles = await this.accounts.listRoles(account.id);
        return { profile: toUserProfile(account), ...await this.startSession(account.id, roles) };
    }

    /**
     * Send a short-lived verification link to the account's address.
     * @param accountId Account whose address needs verification.
     */
    async sendVerification(accountId: string): Promise<void>
    {
        const { redisEnabled, mail, verificationURL } = this.options;
        if (!redisEnabled || !mail || !verificationURL)
        {
            throw new ServiceError(503, "Email verification is unavailable.");
        }

        const account = await this.accounts.findAccountById(requireId(accountId));
        if (!account || account.emailVerifiedAt)
        {
            return;
        }

        const token = createOpaqueToken();
        const key = `auth:email-verification:${hashToken(token)}`;
        const url = new URL(verificationURL);
        url.searchParams.set("token", token);
        await RedisService.setKey(key, { id: account.id, email: account.email }, verificationTtlSeconds);
        try
        {
            await mail.send({ to: account.email, subject: "Verify your Aggies Learn email", text: `Verify your email at ${url.href}` });
        }
        catch (error)
        {
            await RedisService.deleteKey(key).catch(() => undefined);
            throw error;
        }
    }

    /**
     * Consume a verification token once and update the account.
     * @param token Single-use token from the verification link.
     */
    async verifyEmail(token: string): Promise<void>
    {
        this.requireRedis();
        if (typeof token !== "string" || !opaqueTokenPattern.test(token))
        {
            throw new ServiceError(400, "Invalid or expired verification link.");
        }

        const target = await RedisService.takeKey<VerificationTarget>(`auth:email-verification:${hashToken(token)}`);
        if (!target?.email || !await this.users.markEmailVerified(target.id, new Date().toISOString(), target.email))
        {
            throw new ServiceError(400, "Invalid or expired verification link.");
        }
    }

    /**
     * Rotate a refresh token and renew the access token.
     * @param refreshToken Current token containing the session ID and secret.
     * @returns New access and refresh tokens with the original session expiration.
     */
    async refresh(refreshToken: string)
    {
        const { key, sessionId, session } = await this.getRefreshSession(refreshToken);
        const roles = await this.accounts.listRoles(session.accountId);
        if (!roles.length)
        {
            throw new ServiceError(401, "Invalid or expired session.");
        }

        const accessToken = signAccessToken({ accountId: session.accountId, sessionId, roles });
        const token = createOpaqueToken();
        const next = { ...session, tokenHash: hashToken(token) };
        if (!await RedisService.replaceKey(key, session, next))
        {
            throw new ServiceError(401, "Invalid or expired session.");
        }

        return { accessToken, refreshToken: `${sessionId}.${token}`, refreshExpiresAt: session.expiresAt };
    }

    /**
     * Revoke a refresh session when its current token is presented.
     * @param refreshToken Current token for the session to revoke.
     */
    async logout(refreshToken: string): Promise<void>
    {
        const { key, session } = await this.getRefreshSession(refreshToken);
        await RedisService.deleteMatchingKey(key, session);
    }

    /**
     * Start a session with a fixed refresh expiration.
     * @param accountId Account starting the session.
     * @param roles Current roles to include in the access token.
     * @returns Access token and refresh details when Redis is enabled.
     */
    private async startSession(accountId: string, roles: AccountRole[])
    {
        const sessionId = randomUUID();
        const accessToken = signAccessToken({ accountId, sessionId, roles });
        if (!this.options.redisEnabled)
        {
            return { accessToken };
        }

        const token = createOpaqueToken();
        const expiresAt = Date.now() + refreshTtlSeconds * 1000;
        const session: RefreshSession = { accountId, tokenHash: hashToken(token), expiresAt };
        await RedisService.setKey(`auth:sessions:${sessionId}`, session, refreshTtlSeconds);
        return { accessToken, refreshToken: `${sessionId}.${token}`, refreshExpiresAt: expiresAt };
    }

    /**
     * Load the session matching a refresh token.
     * @param refreshToken Token presented by the client.
     * @returns Redis key, session ID, and matching session record.
     */
    private async getRefreshSession(refreshToken: string)
    {
        this.requireRedis();
        const parts = typeof refreshToken === "string"
            ? /^([a-f0-9-]{36})\.([a-f0-9]{64})$/.exec(refreshToken)
            : null;
        if (!parts)
        {
            throw new ServiceError(401, "Invalid or expired session.");
        }

        const sessionId = parts[1]!;
        const key = `auth:sessions:${sessionId}`;
        const session = await RedisService.getKey<RefreshSession>(key);
        if (!session || session.expiresAt <= Date.now() ||
            !timingSafeEqual(Buffer.from(session.tokenHash, "hex"), Buffer.from(hashToken(parts[2]!), "hex")))
        {
            throw new ServiceError(401, "Invalid or expired session.");
        }

        return { key, sessionId, session };
    }

    /**
     * Require Redis for operations that need session state.
     */
    private requireRedis(): void
    {
        if (!this.options.redisEnabled)
        {
            throw new ServiceError(503, "Session storage is unavailable.");
        }
    }
}
