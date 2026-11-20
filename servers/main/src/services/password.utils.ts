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

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

import { ServiceError } from "./service.utils.js";

const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };

/**
 * Derive a password key using the existing account hash settings.
 * @param password Password to derive the key from.
 * @param salt Salt used for the account password.
 * @returns Derived scrypt key.
 */
function deriveKey(password: string, salt: Buffer): Promise<Buffer>
{
    return new Promise((resolve, reject) =>
    {
        scrypt(password, salt, 64, options, (error, key) =>
        {
            if (error)
            {
                reject(error);
                return;
            }

            resolve(key);
        });
    });
}

/**
 * Hash a new password using a random salt.
 * @param password New account password.
 * @returns Encoded scrypt hash containing the salt and work settings.
 */
export async function hashPassword(password: string): Promise<string>
{
    if (typeof password !== "string" || password.length < 12 || Buffer.byteLength(password) > 256)
    {
        throw new ServiceError(400, "Password must be at least 12 characters and at most 256 bytes.");
    }

    const salt = randomBytes(16);
    const key = await deriveKey(password, salt);
    return `scrypt:32768:8:3:${salt.toString("hex")}:${key.toString("hex")}`;
}

/**
 * Compare a password with its stored hash.
 * @param password Password supplied during sign-in.
 * @param hash Stored password hash, when available.
 * @returns Whether the password matches the stored hash.
 */
export async function verifyPassword(password: string, hash?: string | null): Promise<boolean>
{
    if (typeof password !== "string" || Buffer.byteLength(password) > 256)
    {
        return false;
    }

    const parts = /^scrypt:32768:8:3:([a-f0-9]{32}):([a-f0-9]{128})$/.exec(hash ?? "");
    // Do comparable work when an account has no password hash
    const salt = parts ? Buffer.from(parts[1]!, "hex") : Buffer.alloc(16);
    const key = await deriveKey(password, salt);
    return parts !== null && timingSafeEqual(key, Buffer.from(parts[2]!, "hex"));
}
