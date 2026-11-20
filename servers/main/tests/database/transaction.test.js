import { expect, jest, test } from "@jest/globals";

import { createTransactionRunner } from "../../dist/database/transaction.js";

/** Create a fake MySQL connection and record lifecycle calls. */
function createDatabase()
{
    const connection = {
        query: jest.fn().mockResolvedValue([]),
        beginTransaction: jest.fn().mockResolvedValue(undefined),
        commit: jest.fn().mockResolvedValue(undefined),
        rollback: jest.fn().mockResolvedValue(undefined),
        release: jest.fn(),
        destroy: jest.fn(),
    };
    const database = {
        connect: jest.fn().mockResolvedValue({ getConnection: jest.fn().mockResolvedValue(connection) }),
    };
    return { connection, database };
}

test("runs a transaction at READ COMMITTED, commits, and releases the connection", async () =>
{
    const { connection, database } = createDatabase();
    // Check that the callback runs after begin and before commit
    const work = jest.fn(async () =>
    {
        expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
        expect(connection.commit).not.toHaveBeenCalled();
        return "result";
    });

    await expect(createTransactionRunner(database)(work)).resolves.toBe("result");
    expect(work).toHaveBeenCalledWith(connection);
    expect(connection.query).toHaveBeenCalledWith("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.release).toHaveBeenCalledTimes(1);
    expect(connection.rollback).not.toHaveBeenCalled();
});

test("rolls back and releases the connection if an operation fails", async () =>
{
    const { connection, database } = createDatabase();
    const error = new Error("Outbox insert failed");

    await expect(createTransactionRunner(database)(async () => { throw error; })).rejects.toBe(error);
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.release).toHaveBeenCalledTimes(1);
});

test("destroys a connection whose rollback failed", async () =>
{
    const { connection, database } = createDatabase();
    const failure = new Error("Insert failed");
    const rollbackFailure = new Error("Connection lost");
    connection.rollback.mockRejectedValue(rollbackFailure);

    await expect(createTransactionRunner(database)(async () => { throw failure; }))
        .rejects.toMatchObject({ errors: [failure, rollbackFailure] });
    expect(connection.destroy).toHaveBeenCalledTimes(1);
});
