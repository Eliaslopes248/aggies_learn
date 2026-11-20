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

import { createPool, type Pool, type PoolOptions } from "mysql2/promise";

import { type IDatabaseService } from "./database.service.js";

/** Creates and verifies a shared MySQL pool before repositories use it. */
export class MySQLService implements IDatabaseService<Pool> {
    
    // Class fields
    private connection: Promise<Pool> | undefined;
    private shutdown: Promise<void> | undefined;
    private readonly options: PoolOptions;

    constructor(options: PoolOptions) {
        this.options = options;
    }


    connect(): Promise<Pool> {

        // reject connection attempt if shutting down
        if (this.shutdown) {
            return Promise.reject(new Error("The MySQL pool is shutting down."));
        }

        // try to connect to server
        this.connection ??= this.openPool().catch((error: unknown) => {
            this.connection = undefined;
            throw error;
        });

        return this.connection;
    }

    disconnect(): Promise<void> {
        // server connection is already shut down
        if (this.shutdown) {
            return this.shutdown;
        }

        if (!this.connection) {
            return Promise.resolve();
        }

        // Shut down connection
        this.shutdown = this.connection
            .then(pool => pool.end(), () => undefined)
            .finally(() => {
                this.connection = undefined;
                this.shutdown = undefined;
            });

        return this.shutdown;
    }

    private async openPool(): Promise<Pool> {
        const pool = createPool({ timezone: "Z", ...this.options });

        try {
            const connection = await pool.getConnection();
            try {
                await connection.ping();
            } finally {
                connection.release();
            }
        } catch (error) {
            await pool.end();
            throw error;
        }

        return pool;
    }
}
