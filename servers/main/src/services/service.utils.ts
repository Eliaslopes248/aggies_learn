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

import { type PoolConnection } from "mysql2/promise";

import { type AccountRole } from "../database/models/users.model.js";
import { type IUserRepository } from "../database/repositories/interfaces/users.interface.js";

export class ServiceError extends Error
{
    /**
     * Create a service error that can be returned to the client.
     * @param status HTTP status code.
     * @param message Error message for the client.
     */
    constructor(readonly status: number, message: string)
    {
        super(message);
    }
}

/**
 * Validate a decimal ID before it reaches a MySQL cast.
 * @param id Decimal string representing a positive MySQL BIGINT.
 * @returns Validated ID.
 */
export function requireId(id: string): string
{
    if (typeof id !== "string" || !/^[1-9][0-9]{0,18}$/.test(id) || BigInt(id) > 9_223_372_036_854_775_807n)
    {
        throw new ServiceError(400, "Invalid ID.");
    }

    return id;
}

/**
 * Trim and validate a required text field.
 * @param value Text supplied by the caller.
 * @param maxLength Maximum allowed length after trimming.
 * @param field Field name used in the error message.
 * @returns Trimmed text.
 */
export function requireText(value: string, maxLength: number, field: string): string
{
    const text = typeof value === "string" ? value.trim() : "";
    if (!text || text.length > maxLength)
    {
        throw new ServiceError(400, `${field} must contain 1 to ${maxLength} characters.`);
    }

    return text;
}

/**
 * Check the account's current role in MySQL.
 * @param users Repository used to load assigned roles.
 * @param accountId Account whose current roles are checked.
 * @param role Role required to perform the operation.
 * @param connection Optional connection for the caller’s transaction.
 */
export async function requireAccountRole(users: IUserRepository, accountId: string, role: AccountRole, connection?: PoolConnection): Promise<void>
{
    const roles = await users.listRoles(requireId(accountId), connection);
    if (!roles.includes(role))
    {
        throw new ServiceError(403, `The ${role} role is required.`);
    }
}

/**
 * Validate pagination shared by service list operations.
 * @param limit Number of records requested per page.
 * @param offset Number of records to skip.
 */
export function requirePage(limit: number, offset: number): void
{
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0)
    {
        throw new ServiceError(400, "Invalid pagination.");
    }
}
