import { afterEach, expect, jest, test } from "@jest/globals";

import { RedisService } from "../../dist/database/redis.service.js";
import { UserService } from "../../dist/services/users.service.js";

const account = {
    id: "7", email: "student@example.test", firstName: "Avery", lastName: "Reed",
    passwordHash: "private", createdAt: "2026-11-19T00:00:00.000000Z", emailVerifiedAt: null,
};
// Build the expected profile from a row that includes a password hash
const { passwordHash, ...profile } = account;
const key = "users:7:profile";

afterEach(() => jest.restoreAllMocks());

test("returns a cached profile without a database lookup", async () =>
{
    const cache = jest.spyOn(RedisService, "getKey").mockResolvedValue(profile);
    const repository = { findAccountById: jest.fn() };

    await expect(new UserService(repository).getProfile(account.id)).resolves.toEqual(profile);
    expect(cache).toHaveBeenCalledWith(key);
    expect(repository.findAccountById).not.toHaveBeenCalled();
});

test("loads the profile from MySQL and caches only safe fields for five minutes", async () =>
{
    jest.spyOn(RedisService, "getKey").mockRejectedValue(new Error("Redis unavailable"));
    const cache = jest.spyOn(RedisService, "setKey").mockResolvedValue(undefined);
    const repository = { findAccountById: jest.fn().mockResolvedValue(account) };

    await expect(new UserService(repository).getProfile(account.id)).resolves.toEqual(profile);
    expect(repository.findAccountById).toHaveBeenCalledWith(account.id);
    expect(cache).toHaveBeenCalledWith(key, profile, 300);
});

test("does not cache a missing account", async () =>
{
    jest.spyOn(RedisService, "getKey").mockResolvedValue(null);
    const cache = jest.spyOn(RedisService, "setKey").mockResolvedValue(undefined);
    const repository = { findAccountById: jest.fn().mockResolvedValue(null) };

    await expect(new UserService(repository).getProfile(account.id)).resolves.toBeNull();
    expect(cache).not.toHaveBeenCalled();
});

test("clears the cached profile only after email verification is saved", async () =>
{
    const clear = jest.spyOn(RedisService, "deleteKey").mockResolvedValue(undefined);
    const timestamp = "2026-11-19T00:00:00Z";
    // Check that invalidation waits for the repository write
    const repository = { markEmailVerified: jest.fn(async () => expect(clear).not.toHaveBeenCalled()) };
    const users = new UserService(repository);

    await users.markEmailVerified(account.id, timestamp);
    expect(repository.markEmailVerified).toHaveBeenCalledWith(account.id, timestamp);
    expect(clear).toHaveBeenCalledWith(key);
});

test("validates tutor name edits and clears the cached profile after saving", async () =>
{
    const clear = jest.spyOn(RedisService, "deleteKey").mockResolvedValue(undefined);
    const repository = { updateTutorName: jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true) };
    const users = new UserService(repository);

    await expect(users.updateTutorName(account.id, "", "Brooks")).rejects.toMatchObject({ status: 400 });
    await expect(users.updateTutorName(account.id, "Avery", "Brooks")).rejects.toMatchObject({ status: 404 });
    expect(clear).not.toHaveBeenCalled();

    await users.updateTutorName(account.id, " Avery ", " Brooks ");
    expect(repository.updateTutorName.mock.calls).toEqual([[account.id, "Avery", "Brooks"], [account.id, "Avery", "Brooks"]]);
    expect(clear).toHaveBeenCalledWith(key);
});
