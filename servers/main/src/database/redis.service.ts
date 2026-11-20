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

import { createClient, type RedisClientType } from "redis";

import { type RedisSettings } from "../settings/types.js";

export class RedisService {

    // Global redis client
    private static client: RedisClientType | undefined;
    private static connection: Promise<void> | undefined;
    private static shutdown: Promise<void> | undefined;

    /**
     * Configure and connect the shared Redis client.
     * @param settings Redis connection settings.
     */
    static configureRedis(settings: RedisSettings): Promise<void> {
        if (this.shutdown) 
        {
            return Promise.reject(new Error("The Redis client is shutting down."));
        }

        if (this.connection) 
        {
            return this.connection;
        }

        let connected = false;
        const client = createClient({
            url: settings.url,
            disableOfflineQueue: true,
            socket: {
                reconnectStrategy: retries => connected ? Math.min(50 * 2 ** retries, 3000) : false,
            },
        });
        client.on("error", error => console.error("Redis client error:", error));

        this.client = client;
        this.connection = client.connect()
            .then(() => {
                connected = true;
            })
            .catch((error: unknown) => {
                this.client = undefined;
                this.connection = undefined;
                throw error;
            });

        return this.connection;
    }

    /**
     * Close the shared Redis client.
     */
    static disconnect(): Promise<void> {
        const client = this.client;
        const connection = this.connection;
        if (!client || !connection) 
        {
            return Promise.resolve();
        }

        // Wait for startup before closing the client
        this.shutdown ??= connection.then(async () => {
            if (client.isReady) {
                await client.close();
            } else if (client.isOpen) {
                client.destroy();
            }
        }, () => undefined).finally(() => {
            this.client = undefined;
            this.connection = undefined;
            this.shutdown = undefined;
        });

        return this.shutdown;
    }

    /**
     * Return the cached value or cache the callback result.
     * @param name Redis key.
     * @param cb Callback that returns a JSON-serializable value.
     */
    static async getOrSetKey<T>(name: string, cb: () => T | Promise<T>): Promise<T> {
        const client = await this.getClient();
        const cached = await client.get(name);

        if (cached !== null) 
        {
            return JSON.parse(cached) as T;
        }

        const value = await cb();
        await this.setKey(name, value);
        return value;
    }

    /**
     * Store a JSON-serializable value in Redis.
     * @param name Redis key.
     * @param data Value to cache.
     * @param ttlSeconds Optional time before the key expires.
     */
    static async setKey<T>(name: string, data: T, ttlSeconds?: number): Promise<void> {
        const client = await this.getClient();
        const value = JSON.stringify(data);

        if (value === undefined) 
        {
            throw new TypeError("Redis cache values must be JSON-serializable.");
        }

        await client.set(name, value, ttlSeconds === undefined
            ? undefined
            : { expiration: { type: "EX", value: ttlSeconds } });
    }

    /**
     * Delete a cached value.
     * @param name Redis key.
     */
    static async deleteKey(name: string): Promise<void>
    {
        const client = await this.getClient();
        await client.del(name);
    }

    /** Read a value and remove it in one Redis operation. */
    static async takeKey<T>(name: string): Promise<T | null>
    {
        const client = await this.getClient();
        const value = await client.getDel(name);
        return value === null ? null : JSON.parse(value) as T;
    }

    /** Replace a value only if it still matches, preserving its expiry. */
    static async replaceKey<T>(name: string, expected: T, next: T): Promise<boolean>
    {
        const client = await this.getClient();
        const result = await client.eval(
            `if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
             redis.call('SET', KEYS[1], ARGV[2], 'KEEPTTL')
             return 1`,
            { keys: [name], arguments: [JSON.stringify(expected), JSON.stringify(next)] },
        );
        return result === 1;
    }

    /** Remove a key only if its value still matches. */
    static async deleteMatchingKey<T>(name: string, expected: T): Promise<void>
    {
        const client = await this.getClient();
        await client.eval(
            `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
             return 0`,
            { keys: [name], arguments: [JSON.stringify(expected)] },
        );
    }

    /**
     * Return the cached value or the default if the key is missing.
     * @param name Redis key.
     * @param defaultValue Value to return on a cache miss.
     */
    static async getKey<T>(name: string, defaultValue: T | null = null): Promise<T | null> {
        const client = await this.getClient();
        const cached = await client.get(name);
        return cached === null ? defaultValue : JSON.parse(cached) as T;
    }

    /**
     * Get the configured Redis client.
     */
    private static async getClient(): Promise<RedisClientType> {
        const client = this.client;
        if (!client) 
        {
            throw new Error("RedisService.configureRedis() must be called first.");
        }

        await this.connection;
        return client;
    }
}
