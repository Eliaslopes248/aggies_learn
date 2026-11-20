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

import { type Account, type AccountProfile, type AccountRole } from "../../models/users.model.js";

// Account fields supplied when creating a user
export type NewAccount = Pick<Account, "email" | "firstName" | "lastName" | "passwordHash">;

export interface IUserRepository {
    /**
     * Create an account and its initial roles in one transaction.
     * @param account Account details with a hashed password, if available.
     * @param roles Roles to assign to the new account.
     * @param transaction Optional connection to an existing transaction.
     * @returns Created account.
     */
    createAccount(account: NewAccount, roles: readonly AccountRole[], transaction?: PoolConnection): Promise<Account>;

    /**
     * Find an account by ID.
     * @param accountId Account ID.
     * @returns Account or null if it does not exist.
     */
    findAccountById(accountId: string, transaction?: PoolConnection): Promise<Account | null>;

    /**
     * Find an account by its normalized email address.
     * @param email Lowercase, trimmed email address.
     * @returns Account or null if it does not exist.
     */
    findAccountByEmail(email: string, transaction?: PoolConnection): Promise<Account | null>;

    /**
     * List tutors whose names match the search, in name order.
     * @param search Optional first or last name query.
     * @param limit Maximum number of tutors to return.
     * @param offset Number of matching tutors to skip.
     * @returns Tutor profiles without credential fields.
     */
    listTutors(search: string, limit: number, offset: number): Promise<AccountProfile[]>;

    /**
     * List students whose names match the search, in name order.
     * @param search Optional first or last name query.
     * @param limit Maximum number of students to return.
     * @param offset Number of matching students to skip.
     * @returns Student profiles without credential fields.
     */
    listStudents(search: string, limit: number, offset: number): Promise<AccountProfile[]>;

    /**
     * Update an account name while the account has the tutor role.
     * @param tutorId Tutor account ID.
     * @param firstName Updated first name.
     * @param lastName Updated last name.
     * @returns Whether a tutor account matched the ID.
     */
    updateTutorName(tutorId: string, firstName: string, lastName: string): Promise<boolean>;

    /**
     * Update an account name while the account has the student role.
     * @param studentId Student account ID.
     * @param firstName Updated first name.
     * @param lastName Updated last name.
     * @returns Whether a student account matched the ID.
     */
    updateStudentName(studentId: string, firstName: string, lastName: string): Promise<boolean>;

    /**
     * Update the account's password hash.
     * @param accountId Account ID.
     * @param passwordHash Hash of the new password.
     */
    updatePasswordHash(accountId: string, passwordHash: string): Promise<void>;

    /**
     * Record when an account's email was verified.
     * @param accountId Account ID.
     * @param verifiedAt UTC verification timestamp.
     */
    markEmailVerified(accountId: string, verifiedAt: string): Promise<void>;

    /**
     * List the roles assigned to an account.
     * @param accountId Account ID.
     * @returns Assigned roles.
     */
    listRoles(accountId: string, transaction?: PoolConnection): Promise<AccountRole[]>;

    /**
     * Assign a role to an account if it is missing.
     * @param accountId Account ID.
     * @param role Role to assign.
     * @param transaction Optional connection to an existing transaction.
     */
    assignRole(accountId: string, role: AccountRole, transaction?: PoolConnection): Promise<void>;

    /**
     * Remove a role from an account if it is assigned.
     * @param accountId Account ID.
     * @param role Role to remove.
     */
    removeRole(accountId: string, role: AccountRole): Promise<void>;
}
