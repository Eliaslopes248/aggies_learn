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

import { type Account, type AccountRole } from "../database/models/users.model.js";
import { RedisService } from "../database/redis.service.js";
import { type IUserRepository, type NewAccount } from "../database/repositories/interfaces/users.interface.js";

// Keep cached profiles short-lived
const profileCacheTtlSeconds = 300;
type UserProfile = Omit<Account, "passwordHash">;

/**
 * Get the Redis key for a user profile.
 * @param accountId Account ID.
 * @returns Namespaced profile cache key.
 */
function getProfileCacheKey(accountId: string): string
{
    return `users:${accountId}:profile`;
}

/**
 * Select the account fields that can be sent to clients.
 * @param account Stored account.
 * @returns Account details without credentials.
 */
export function toUserProfile(account: Account): UserProfile
{
    const { id, email, firstName, lastName, emailVerifiedAt, createdAt } = account;
    return { id, email, firstName, lastName, emailVerifiedAt, createdAt };
}

export class UserService
{
    private readonly userRepository: IUserRepository;

    /**
     * Create a user service with its account repository.
     * @param userRepository Repository used to access accounts and roles.
     */
    constructor(userRepository: IUserRepository)
    {
        this.userRepository = userRepository;
    }

    /**
     * Create an account with its initial roles.
     * @param account Account details with a hashed password, if available.
     * @param roles Roles to assign to the new account.
     * @returns Created account.
     */
    createAccount(account: NewAccount, roles: readonly AccountRole[]): Promise<Account>
    {
        const email = account.email.trim().toLowerCase();
        return this.userRepository.createAccount({ ...account, email }, roles);
    }

    /**
     * Find an account by ID.
     * @param accountId Account ID.
     * @returns Account or null if it does not exist.
     */
    findAccountById(accountId: string): Promise<Account | null>
    {
        return this.userRepository.findAccountById(accountId);
    }

    /**
     * Get a user profile from Redis or load it from MySQL.
     * @param accountId Account ID.
     * @returns Profile or null if the account does not exist.
     */
    async getProfile(accountId: string): Promise<UserProfile | null>
    {
        const key = getProfileCacheKey(accountId);

        // Fall back to MySQL when Redis is unavailable
        const cached = await RedisService.getKey<UserProfile>(key).catch(() => null);
        if (typeof cached?.firstName === "string" && typeof cached.lastName === "string")
        {
            return cached;
        }

        const account = await this.findAccountById(accountId);
        if (!account)
        {
            return null;
        }

        const profile = toUserProfile(account);

        // cache user profile
        await RedisService.setKey(key, profile, profileCacheTtlSeconds).catch(() => undefined);
        return profile;
    }

    /**
     * Find an account by email.
     * @param email Email address to look up.
     * @returns Account or null if it does not exist.
     */
    findAccountByEmail(email: string): Promise<Account | null>
    {
        return this.userRepository.findAccountByEmail(email.trim().toLowerCase());
    }

    /**
     * Update an account's password hash.
     * @param accountId Account ID.
     * @param passwordHash Hash of the new password.
     */
    updatePasswordHash(accountId: string, passwordHash: string): Promise<void>
    {
        return this.userRepository.updatePasswordHash(accountId, passwordHash);
    }

    /**
     * Record when an account's email was verified.
     * @param accountId Account ID.
     * @param verifiedAt UTC verification timestamp.
     */
    async markEmailVerified(accountId: string, verifiedAt: string): Promise<void>
    {
        await this.userRepository.markEmailVerified(accountId, verifiedAt);

        // Clear the cached verification status after the database update
        await RedisService.deleteKey(getProfileCacheKey(accountId)).catch(() => undefined);
    }

    /**
     * List the roles assigned to an account.
     * @param accountId Account ID.
     * @returns Assigned roles.
     */
    listRoles(accountId: string): Promise<AccountRole[]>
    {
        return this.userRepository.listRoles(accountId);
    }

    /**
     * Assign a role to an account.
     * @param accountId Account ID.
     * @param role Role to assign.
     */
    assignRole(accountId: string, role: AccountRole): Promise<void>
    {
        return this.userRepository.assignRole(accountId, role);
    }

    /**
     * Remove a role from an account.
     * @param accountId Account ID.
     * @param role Role to remove.
     */
    removeRole(accountId: string, role: AccountRole): Promise<void>
    {
        return this.userRepository.removeRole(accountId, role);
    }
}
