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

import { type Pool, type PoolConnection } from "mysql2/promise";

import { type IDatabaseService } from "./database.service.js";

export type RunTransaction = <T>(work: (connection: PoolConnection) => Promise<T>) => Promise<T>;

/**
 * Run a service operation on one MySQL connection.
 * @param database Shared database service.
 */
export function createTransactionRunner(database: IDatabaseService<Pool>): RunTransaction
{
    return async work =>
    {
        const pool = await database.connect();
        const connection = await pool.getConnection();

        try
        {
            await connection.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
            await connection.beginTransaction();
            const result = await work(connection);
            await connection.commit();
            return result;
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
                throw new AggregateError([error, rollbackError], "Transaction and rollback failed.");
            }

            throw error;
        }
        finally
        {
            connection.release();
        }
    };
}
