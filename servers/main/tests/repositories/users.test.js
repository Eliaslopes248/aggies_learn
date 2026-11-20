import { expect, jest, test } from "@jest/globals";

import { MySQLUserRepository } from "../../dist/database/repositories/mysql/users.repository.js";

test("account creation reuses the caller's transaction and deduplicates initial roles", async () =>
{
    const connection = { execute: jest.fn(), commit: jest.fn(), release: jest.fn() };
    const database = { connect: jest.fn() };
    const input = { email: " Student@example.test ", firstName: "Avery", lastName: "Reed", passwordHash: "private" };
    const account = { ...input, id: "9007199254740993", email: "student@example.test" };
    // Simulate the account insert followed by its generated row lookup
    connection.execute.mockResolvedValueOnce([]).mockResolvedValueOnce([[account]]);
    const users = new MySQLUserRepository(database);

    await expect(users.createAccount(input, ["student", "student"], connection)).resolves.toEqual(account);
    expect(connection.execute.mock.calls[0][1]).toEqual(["student@example.test", "Avery", "Reed", "private"]);
    expect(connection.execute.mock.calls[2][1]).toEqual([account.id, "student"]);
    expect(connection.execute).toHaveBeenCalledTimes(3);
    expect(database.connect).not.toHaveBeenCalled();
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.release).not.toHaveBeenCalled();
});
