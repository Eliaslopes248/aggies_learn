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

import { type Pool, type PoolConnection, type ResultSetHeader, type RowDataPacket } from "mysql2/promise";

import { type IDatabaseService } from "../../database.service.js";
import { type Account, type AccountProfile, type AccountRole } from "../../models/users.model.js";
import { type IUserRepository, type NewAccount, type ProfileChanges } from "../interfaces/users.interface.js";

// represents a single account row
interface AccountRow extends RowDataPacket, Account {}
interface AccountProfileRow extends RowDataPacket, AccountProfile {}

interface AccountRoleRow extends RowDataPacket {
    role: AccountRole;
}

// Keep BIGINT IDs and UTC timestamps precise across driver settings
const accountProfileColumns = `
    CAST(id AS CHAR) AS id,
    email,
    first_name AS firstName,
    last_name AS lastName,
    DATE_FORMAT(email_verified_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS emailVerifiedAt,
    DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS createdAt
`;
const selectAccounts = `SELECT ${accountProfileColumns}, password_hash AS passwordHash FROM accounts`;

export class MySQLUserRepository implements IUserRepository {
    private readonly database: IDatabaseService<Pool>;

    /**
     * Create a user repository with the shared database service.
     * @param db MySQL database service.
     */
    constructor(db: IDatabaseService<Pool>) {
        this.database = db;
    }

    /** @inheritdoc */
    async createAccount(account: NewAccount, roles: readonly AccountRole[], transaction?: PoolConnection): Promise<Account>
    {
        if (transaction)
        {
            return this.insertAccount(account, roles, transaction);
        }

        const pool = await this.database.connect();
        const connection = await pool.getConnection();

        try
        {
            await connection.beginTransaction();
            const created = await this.insertAccount(account, roles, connection);
            await connection.commit();
            return created;
        }
        catch (error)
        {
            try
            {
                await connection.rollback();
            }
            catch (rollbackError)
            {
                connection.destroy();
                throw new AggregateError([error, rollbackError], "Account creation and rollback failed.");
            }

            throw error;
        }
        finally
        {
            connection.release();
        }
    }

    /**
     * Insert an account and roles on the same connection.
     * @param account Account details.
     * @param roles Initial account roles.
     * @param connection Connection used for the transaction.
     */
    private async insertAccount(account: NewAccount, roles: readonly AccountRole[], connection: PoolConnection): Promise<Account>
    {
        await connection.execute(
            "INSERT INTO accounts (email, first_name, last_name, password_hash) VALUES (?, ?, ?, ?)",
            [account.email.trim().toLowerCase(), account.firstName, account.lastName, account.passwordHash],
        );

        // Read the generated ID on the same connection
        const [[created]] = await connection.execute<AccountRow[]>(
            `${selectAccounts} WHERE id = LAST_INSERT_ID()`,
        );
        if (!created)
        {
            throw new Error("Unable to load the new account.");
        }

        for (const role of new Set(roles))
        {
            await connection.execute(
                "INSERT INTO account_roles (account_id, role) VALUES (?, ?)",
                [created.id, role],
            );
        }
        return created;
    }

    /** @inheritdoc */
    async findAccountById(accountId: string, transaction?: PoolConnection): Promise<Account | null> {
        const executor = transaction ?? await this.database.connect();
        const [[account]] = await executor.execute<AccountRow[]>(
            `${selectAccounts} WHERE id = CAST(? AS SIGNED)`,
            [this.validateAccountId(accountId)],
        );
        return account ?? null;
    }

    /** @inheritdoc */
    async findAccountByEmail(email: string, transaction?: PoolConnection): Promise<Account | null> {
        const executor = transaction ?? await this.database.connect();
        const [[account]] = await executor.execute<AccountRow[]>(
            `${selectAccounts} WHERE email = ?`,
            [email.trim().toLowerCase()],
        );
        return account ?? null;
    }

    /** @inheritdoc */
    listTutors(search: string, limit: number, offset: number): Promise<AccountProfile[]>
    {
        return this.listDirectoryProfiles("tutor", search, limit, offset);
    }

    /** @inheritdoc */
    listStudents(search: string, limit: number, offset: number): Promise<AccountProfile[]>
    {
        return this.listDirectoryProfiles("student", search, limit, offset);
    }

    /** Read one page of matching profiles for the requested account role. */
    private async listDirectoryProfiles(role: AccountRole, search: string, limit: number, offset: number): Promise<AccountProfile[]>
    {
        const pool = await this.database.connect();

        // Match partial names in either order and escape literal wildcard characters.
        const pattern = `%${search.split(" ").map(part => part.replace(/[!%_]/g, "!$&")).join("%")}%`;
        const [rows] = await pool.execute<AccountProfileRow[]>(
            `SELECT ${accountProfileColumns}
             FROM accounts
             WHERE EXISTS (
                 SELECT 1 FROM account_roles WHERE account_id = accounts.id AND role = ?
             )
             AND (CONCAT(first_name, ' ', last_name) LIKE ? ESCAPE '!'
                  OR CONCAT(last_name, ' ', first_name) LIKE ? ESCAPE '!')
             ORDER BY last_name, first_name, accounts.id
             LIMIT ? OFFSET ?`,
            [role, pattern, pattern, limit, offset],
        );
        return rows;
    }

    /** @inheritdoc */
    updateTutorName(tutorId: string, firstName: string, lastName: string): Promise<boolean>
    {
        return this.updateDirectoryName("tutor", tutorId, firstName, lastName);
    }

    /** @inheritdoc */
    updateStudentName(studentId: string, firstName: string, lastName: string): Promise<boolean>
    {
        return this.updateDirectoryName("student", studentId, firstName, lastName);
    }

    /** Update the name only while the account holds the requested role. */
    private async updateDirectoryName(role: AccountRole, accountId: string, firstName: string, lastName: string): Promise<boolean>
    {
        const pool = await this.database.connect();
        const [result] = await pool.execute<ResultSetHeader>(
            `UPDATE accounts
             SET first_name = ?, last_name = ?
             WHERE id = CAST(? AS SIGNED) AND EXISTS (
                 SELECT 1 FROM account_roles WHERE account_id = accounts.id AND role = ?
             )`,
            [firstName, lastName, this.validateAccountId(accountId), role],
        );
        return result.affectedRows > 0;
    }

    /** @inheritdoc */
    async updateProfile(account: Account, changes: ProfileChanges): Promise<boolean>
    {
        const pool = await this.database.connect();
        const [result] = await pool.execute<ResultSetHeader>(
            `UPDATE accounts
             SET first_name = ?, last_name = ?,
                 email_verified_at = IF(BINARY email = BINARY ?, email_verified_at, NULL),
                 email = ?, password_hash = ?
             WHERE id = CAST(? AS SIGNED) AND BINARY email = BINARY ? AND password_hash <=> ?`,
            [changes.firstName, changes.lastName, changes.email, changes.email,
                changes.passwordHash ?? account.passwordHash, this.validateAccountId(account.id),
                account.email, account.passwordHash],
        );
        return result.affectedRows > 0;
    }

    /** @inheritdoc */
    async updateStudentPassword(account: Account, passwordHash: string | null): Promise<boolean>
    {
        const pool = await this.database.connect();
        const [result] = await pool.execute<ResultSetHeader>(
            `UPDATE accounts SET password_hash = ?
             WHERE id = CAST(? AS SIGNED) AND BINARY email = BINARY ? AND password_hash <=> ?
             AND email_verified_at <=> ?
             AND EXISTS (
                 SELECT 1 FROM account_roles WHERE account_id = accounts.id AND role = 'student'
             )`,
            [passwordHash, this.validateAccountId(account.id), account.email, account.passwordHash,
                account.emailVerifiedAt?.slice(0, -1).replace("T", " ") ?? null],
        );
        return result.affectedRows > 0;
    }

    /** @inheritdoc */
    async updatePasswordHash(accountId: string, passwordHash: string): Promise<void> {
        const pool = await this.database.connect();
        await pool.execute(
            "UPDATE accounts SET password_hash = ? WHERE id = CAST(? AS SIGNED)",
            [passwordHash, this.validateAccountId(accountId)],
        );
    }

    /** @inheritdoc */
    async markEmailVerified(accountId: string, verifiedAt: string, email: string): Promise<boolean>
    {
        const timestamp = verifiedAt.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/)?.[0];
        if (!timestamp)
        {
            throw new TypeError("Email verification time must be an ISO 8601 UTC timestamp.");
        }

        // Store the UTC timestamp in a MySQL DATETIME column
        const pool = await this.database.connect();
        const [result] = await pool.execute<ResultSetHeader>(
            "UPDATE accounts SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = CAST(? AS SIGNED) AND BINARY email = BINARY ?",
            [timestamp.slice(0, -1).replace("T", " "), this.validateAccountId(accountId), email],
        );
        return result.affectedRows > 0;
    }

    /** @inheritdoc */
    async listRoles(accountId: string, transaction?: PoolConnection): Promise<AccountRole[]>
    {
        const executor = transaction ?? await this.database.connect();
        const [rows] = await executor.execute<AccountRoleRow[]>(
            "SELECT role FROM account_roles WHERE account_id = CAST(? AS SIGNED) ORDER BY role",
            [this.validateAccountId(accountId)],
        );
        return rows.map(row => row.role);
    }

    /** @inheritdoc */
    async assignRole(accountId: string, role: AccountRole, transaction?: PoolConnection): Promise<void>
    {
        const executor = transaction ?? await this.database.connect();
        await executor.execute(
            `INSERT INTO account_roles (account_id, role) VALUES (CAST(? AS SIGNED), ?)
             ON DUPLICATE KEY UPDATE role = account_roles.role`,
            [this.validateAccountId(accountId), role],
        );
    }

    /** @inheritdoc */
    async removeRole(accountId: string, role: AccountRole): Promise<void> {
        const pool = await this.database.connect();
        await pool.execute(
            "DELETE FROM account_roles WHERE account_id = CAST(? AS SIGNED) AND role = ?",
            [this.validateAccountId(accountId), role],
        );
    }

    /**
     * Validate an account ID before casting it in MySQL.
     * @param accountId Decimal string representing a positive BIGINT.
     * @returns Validated account ID.
     */
    private validateAccountId(accountId: string): string {
        if (!/^[1-9][0-9]{0,18}$/.test(accountId) || BigInt(accountId) > 9_223_372_036_854_775_807n)
        {
            throw new TypeError("Account ID must be a positive BIGINT.");
        }

        return accountId;
    }
}
