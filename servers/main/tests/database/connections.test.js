import { afterEach, expect, jest, test } from "@jest/globals";

const createPool = jest.fn();
const createClient = jest.fn();

// Replace only the driver factories, keeping the connection services real
jest.unstable_mockModule("mysql2/promise", () => ({ createPool }));
jest.unstable_mockModule("redis", () => ({ createClient }));

const { MySQLService } = await import("../../dist/database/mysql.service.js");
const { RedisService } = await import("../../dist/database/redis.service.js");

afterEach(async () =>
{
    await RedisService.disconnect();
    createPool.mockReset();
    createClient.mockReset();
});

/**
 * Create a fake pool and connection for lifecycle checks.
 * @returns Pool and the connection it lends.
 */
function createMySQLFixture()
{
    const connection = { ping: jest.fn().mockResolvedValue(undefined), release: jest.fn() };
    const pool = { getConnection: jest.fn().mockResolvedValue(connection), end: jest.fn().mockResolvedValue(undefined) };
    return { pool, connection };
}

test("shares one verified MySQL pool and closes it once", async () =>
{
    const { pool, connection } = createMySQLFixture();
    createPool.mockReturnValue(pool);
    const service = new MySQLService({ host: "mysql" });

    await expect(Promise.all([service.connect(), service.connect()])).resolves.toEqual([pool, pool]);
    expect(createPool).toHaveBeenCalledTimes(1);
    expect(createPool).toHaveBeenCalledWith({ timezone: "Z", host: "mysql" });
    expect(connection.ping).toHaveBeenCalledTimes(1);
    expect(connection.release).toHaveBeenCalledTimes(1);

    await Promise.all([service.disconnect(), service.disconnect()]);
    expect(pool.end).toHaveBeenCalledTimes(1);
});

test("releases a failed MySQL connection and allows another connect attempt", async () =>
{
    const failed = createMySQLFixture();
    const healthy = createMySQLFixture();
    failed.connection.ping.mockRejectedValue(new Error("Ping failed"));
    createPool.mockReturnValueOnce(failed.pool).mockReturnValueOnce(healthy.pool);
    const service = new MySQLService({});

    await expect(service.connect()).rejects.toThrow("Ping failed");
    expect(failed.connection.release).toHaveBeenCalledTimes(1);
    expect(failed.pool.end).toHaveBeenCalledTimes(1);
    await expect(service.connect()).resolves.toBe(healthy.pool);
    await service.disconnect();
});

test("shares one Redis client and writes JSON with expiration", async () =>
{
    const client = {
        on: jest.fn(), connect: jest.fn().mockResolvedValue(undefined), isReady: true,
        close: jest.fn().mockResolvedValue(undefined), set: jest.fn().mockResolvedValue("OK"),
        get: jest.fn().mockResolvedValue('{"id":"1"}'),
    };
    createClient.mockReturnValue(client);

    await Promise.all([
        RedisService.configureRedis({ url: "redis://redis:6379" }),
        RedisService.configureRedis({ url: "redis://redis:6379" }),
    ]);
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(client.connect).toHaveBeenCalledTimes(1);

    await RedisService.setKey("users:1:profile", { id: "1" }, 300);
    expect(client.set).toHaveBeenCalledWith("users:1:profile", '{"id":"1"}', {
        expiration: { type: "EX", value: 300 },
    });
    await expect(RedisService.getKey("users:1:profile")).resolves.toEqual({ id: "1" });

    await Promise.all([RedisService.disconnect(), RedisService.disconnect()]);
    expect(client.close).toHaveBeenCalledTimes(1);
    await expect(RedisService.getKey("users:1:profile")).rejects.toThrow("configureRedis");
});
