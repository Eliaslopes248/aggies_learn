import { expect, jest, test } from "@jest/globals";

import { TutoringService } from "../../dist/services/tutoring.service.js";

test("reuses a student's account and saves the tutor role and course grants together", async () =>
{
    // Pass the same fake connection to the role and assignment writes
    const connection = {};
    const account = { id: "2", passwordHash: "private" };
    const users = {
        listRoles: jest.fn().mockResolvedValue(["admin"]),
        findAccountById: jest.fn().mockResolvedValue(account),
        assignRole: jest.fn().mockResolvedValue(undefined),
        createAccount: jest.fn(),
    };
    const catalog = { isCourseActive: jest.fn().mockResolvedValue(true) };
    const assignments = { assign: jest.fn().mockResolvedValue(undefined) };
    const transaction = jest.fn(work => work(connection));
    const service = new TutoringService(users, catalog, assignments, transaction);

    // Repeat one course ID to check that its grant is saved only once
    const profile = await service.provisionTutor("1", { accountId: "2", courseIds: ["3", "3", "4"] });

    expect(profile).not.toHaveProperty("passwordHash");
    expect(users.createAccount).not.toHaveBeenCalled();
    expect(users.assignRole).toHaveBeenCalledWith("2", "tutor", connection);
    expect(assignments.assign.mock.calls).toEqual([
        ["2", "3", "1", connection], ["2", "4", "1", connection],
    ]);
    expect(transaction).toHaveBeenCalledTimes(1);
});

test("rejects a non-admin before opening a provisioning transaction", async () =>
{
    const users = { listRoles: jest.fn().mockResolvedValue(["student"]) };
    const transaction = jest.fn();
    const service = new TutoringService(users, {}, {}, transaction);

    await expect(service.provisionTutor("1", { accountId: "2", courseIds: ["3"] }))
        .rejects.toMatchObject({ status: 403 });
    expect(transaction).not.toHaveBeenCalled();
});

test("rejects an archived course without creating an assignment", async () =>
{
    const users = { listRoles: jest.fn().mockResolvedValueOnce(["admin"]).mockResolvedValueOnce(["tutor"]) };
    const catalog = { isCourseActive: jest.fn().mockResolvedValue(false) };
    const assignments = { assign: jest.fn() };
    const service = new TutoringService(users, catalog, assignments, work => work({}));

    await expect(service.assignCourse("1", "2", "3")).rejects.toMatchObject({ status: 404 });
    expect(assignments.assign).not.toHaveBeenCalled();
});
