import { expect, jest, test } from "@jest/globals";

import { MySQLAvailabilityRepository } from "../../dist/database/repositories/mysql/availability.repository.js";
import { MySQLBookingRepository } from "../../dist/database/repositories/mysql/bookings.repository.js";
import { MySQLCatalogRepository } from "../../dist/database/repositories/mysql/catalog.repository.js";
import { MySQLEmailOutboxRepository } from "../../dist/database/repositories/mysql/email-outbox.repository.js";
import { MySQLTutorAssignmentRepository } from "../../dist/database/repositories/mysql/tutor-assignments.repository.js";

test("checks and locks the active catalog hierarchy on the caller's connection", async () =>
{
    const database = { connect: jest.fn() };
    const connection = { execute: jest.fn().mockResolvedValueOnce([[{ id: "7" }]]).mockResolvedValueOnce([[]]) };
    const catalog = new MySQLCatalogRepository(database);

    await expect(catalog.isCourseActive("7", connection)).resolves.toBe(true);
    await expect(catalog.isCourseActive("8", connection)).resolves.toBe(false);
    expect(connection.execute).toHaveBeenCalledWith(
        expect.stringMatching(/c\.archived_at IS NULL AND d\.archived_at IS NULL AND col\.archived_at IS NULL FOR SHARE/),
        ["7"],
    );
    expect(database.connect).not.toHaveBeenCalled();
});

test("preserves active tutor assignments on retry and deactivates a row once", async () =>
{
    const database = { connect: jest.fn() };
    const connection = { execute: jest.fn().mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ affectedRows: 1 }]).mockResolvedValueOnce([{ affectedRows: 0 }]) };
    const assignments = new MySQLTutorAssignmentRepository(database);

    await assignments.assign("3", "7", "2", connection);
    expect(connection.execute).toHaveBeenNthCalledWith(1,
        expect.stringContaining("assigned_by = IF(deactivated_at IS NULL"), ["3", "7", "2"]);
    await expect(assignments.deactivate("3", "7", connection)).resolves.toBe(true);
    await expect(assignments.deactivate("3", "7", connection)).resolves.toBe(false);
    expect(connection.execute).toHaveBeenNthCalledWith(2, expect.stringContaining("deactivated_at IS NULL"), ["3", "7"]);
    expect(database.connect).not.toHaveBeenCalled();
});

test("uses block ownership, withdrawal state, and UTC time when updating availability", async () =>
{
    const connection = { execute: jest.fn().mockResolvedValue([{ affectedRows: 0 }]) };
    const availability = new MySQLAvailabilityRepository({ connect: jest.fn() });
    const input = { startsAt: "2035-01-01T10:00:00.123456Z", endsAt: "2035-01-01T11:00:00Z", location: "Library" };

    await expect(availability.updateBlock("5", "3", input, connection)).resolves.toBe(false);
    expect(connection.execute).toHaveBeenCalledWith(
        expect.stringContaining("tutor_id = CAST(? AS SIGNED) AND withdrawn_at IS NULL"),
        ["2035-01-01 10:00:00.123456", "2035-01-01 11:00:00", "Library", "5", "3"],
    );
});

test("checks overlapping bookings for both participants in both roles", async () =>
{
    const connection = { execute: jest.fn().mockResolvedValue([[{ id: "6" }]]) };
    const bookings = new MySQLBookingRepository({ connect: jest.fn() });

    await expect(bookings.hasConflict({
        studentId: "1", tutorId: "3", startsAt: "2035-01-01T10:00:00Z", endsAt: "2035-01-01T11:00:00Z",
    }, connection)).resolves.toBe(true);
    expect(connection.execute).toHaveBeenCalledWith(
        expect.stringMatching(/starts_at < \? AND ends_at > \?[\s\S]*student_id IN[\s\S]*OR tutor_id IN/),
        ["2035-01-01 11:00:00", "2035-01-01 10:00:00", "1", "3", "1", "3"],
    );
});

test("filters canceled bookings in MySQL before applying the page limit", async () =>
{
    const pool = { execute: jest.fn().mockResolvedValue([[{ id: "6", canceledAt: "2026-11-19T12:00:00Z" }]]) };
    const database = { connect: jest.fn().mockResolvedValue(pool) };
    const bookings = new MySQLBookingRepository(database);

    await expect(bookings.listBookings({ canceledOnly: true, limit: 25, offset: 25 })).resolves.toHaveLength(1);
    const [[sql, values]] = pool.execute.mock.calls;
    expect(sql).toMatch(/canceled_at IS NOT NULL[\s\S]*LIMIT \? OFFSET \?/);
    expect(values.slice(0, 2)).toEqual([true, true]);
    expect(values.slice(-2)).toEqual([25, 25]);
});

test("makes outbox enqueue idempotent on the booking transaction", async () =>
{
    const database = { connect: jest.fn() };
    const connection = { execute: jest.fn().mockResolvedValue([]) };
    const outbox = new MySQLEmailOutboxRepository(database);

    await outbox.enqueue("6", "3", "booking_confirmed", connection);

    expect(connection.execute).toHaveBeenCalledWith(
        expect.stringContaining("ON DUPLICATE KEY UPDATE id = email_outbox.id"),
        ["6", "3", "booking_confirmed"],
    );
    expect(database.connect).not.toHaveBeenCalled();
});
