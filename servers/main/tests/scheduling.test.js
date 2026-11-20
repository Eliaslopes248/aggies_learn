import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

import { AvailabilityService } from "../dist/services/availability.service.js";
import { BookingService } from "../dist/services/booking.service.js";

const connection = {};
const window = { startsAt: "2026-11-20T10:00:00Z", endsAt: "2026-11-20T12:00:00Z" };
const block = { ...window, id: "4", tutorId: "2", location: "Library", withdrawnAt: null };
const request = {
    availabilityBlockId: block.id, tutorId: "2", courseId: "3",
    startsAt: window.startsAt, endsAt: "2026-11-20T10:30:00Z",
};

// Keep the test slots in the future regardless of when the suite runs
beforeEach(() => jest.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-19T12:00:00Z")));
afterEach(() => jest.restoreAllMocks());

describe("Availability service", () =>
{
    test("deduplicates overlapping availability and subtracts occupied time", async () =>
    {
        const users = { listRoles: jest.fn().mockResolvedValue(["tutor"]) };
        const catalog = { isCourseActive: jest.fn().mockResolvedValue(true) };
        const assignments = { listByCourse: jest.fn().mockResolvedValue([{ tutorId: block.tutorId }]) };
        // Return two blocks covering the same time to check slot deduplication
        const availability = { listBlocks: jest.fn().mockResolvedValue([block, { ...block, id: "6" }]) };
        const bookings = { listBookings: jest.fn().mockResolvedValue([request]) };
        const service = new AvailabilityService(users, catalog, assignments, availability, bookings, work => work(connection));

        const slots = await service.listBookableSlots("3", window);

        expect(slots.map(slot => slot.startsAt)).toEqual([
            "2026-11-20T10:30:00.000Z", "2026-11-20T11:00:00.000Z", "2026-11-20T11:30:00.000Z",
        ]);
        expect(bookings.listBookings).toHaveBeenCalledWith(expect.objectContaining({ participantId: block.tutorId }));
    });

    test("rejects a block edit that would cut out a confirmed booking", async () =>
    {
        const users = { listRoles: jest.fn().mockResolvedValue(["tutor"]) };
        const availability = { lockBlock: jest.fn().mockResolvedValue(block), updateBlock: jest.fn() };
        const bookings = { hasBookingOutsideBlock: jest.fn().mockResolvedValue(true) };
        const service = new AvailabilityService(users, {}, {}, availability, bookings, work => work(connection));
        const edited = { ...block, startsAt: "2026-11-20T11:00:00Z" };

        await expect(service.updateBlock(block.tutorId, block.id, edited)).rejects.toMatchObject({ status: 409 });
        expect(availability.lockBlock).toHaveBeenCalledWith(block.id, connection);
        expect(bookings.hasBookingOutsideBlock).toHaveBeenCalledWith(
            block.id, "2026-11-20T11:00:00.000Z", "2026-11-20T12:00:00.000Z", connection,
        );
        expect(availability.updateBlock).not.toHaveBeenCalled();
    });

    test("keeps a tutor's calendar private", async () =>
    {
        const users = { listRoles: jest.fn().mockResolvedValue(["student"]) };
        const availability = { listBlocks: jest.fn() };
        const service = new AvailabilityService(users, {}, {}, availability, {}, jest.fn());

        await expect(service.listTutorCalendar("1", block.tutorId, window)).rejects.toMatchObject({ status: 403 });
        expect(availability.listBlocks).not.toHaveBeenCalled();
    });
});

/** Create a booking service with successful repository responses by default. */
function createBookingFixture()
{
    const student = { id: "1", emailVerifiedAt: "2026-11-19T00:00:00Z" };
    const users = {
        listRoles: jest.fn(async id => id === student.id ? ["student"] : ["tutor"]),
        findAccountById: jest.fn().mockResolvedValue(student),
    };
    const catalog = { isCourseActive: jest.fn().mockResolvedValue(true) };
    const assignments = { lockAssignment: jest.fn().mockResolvedValue({ deactivatedAt: null }) };
    const availability = { lockBlock: jest.fn().mockResolvedValue(block) };
    const booking = { ...request, studentId: student.id, canceledAt: null };
    const bookings = {
        lockParticipants: jest.fn().mockResolvedValue(true),
        hasConflict: jest.fn().mockResolvedValue(false),
        createBooking: jest.fn().mockResolvedValue("5"),
        findBooking: jest.fn().mockResolvedValue(booking),
        lockBooking: jest.fn().mockResolvedValue(booking),
        cancelBooking: jest.fn().mockResolvedValue(true),
    };
    const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const service = new BookingService(users, catalog, assignments, availability, bookings, outbox, work => work(connection));
    return { service, users, bookings, outbox, booking };
}

describe("Booking service", () =>
{
    test("copies the location and queues confirmation on the booking connection", async () =>
    {
        const { service, bookings, outbox } = createBookingFixture();

        await expect(service.bookSession("1", request)).resolves.toBe("5");
        expect(bookings.lockParticipants).toHaveBeenCalledWith("1", "2", connection);
        expect(bookings.createBooking).toHaveBeenCalledWith(expect.objectContaining({
            studentId: "1", location: "Library", startsAt: "2026-11-20T10:00:00.000Z",
        }), connection);
        expect(outbox.enqueue).toHaveBeenCalledWith("5", "2", "booking_confirmed", connection);
    });

    test("rejects a conflict before writing a booking or email", async () =>
    {
        const { service, bookings, outbox } = createBookingFixture();
        bookings.hasConflict.mockResolvedValue(true);

        await expect(service.bookSession("1", request)).rejects.toMatchObject({ status: 409 });
        expect(bookings.createBooking).not.toHaveBeenCalled();
        expect(outbox.enqueue).not.toHaveBeenCalled();
    });

    test("requires a verified student email before booking", async () =>
    {
        const { service, users, bookings } = createBookingFixture();
        users.findAccountById.mockResolvedValue({ id: "1", emailVerifiedAt: null });

        await expect(service.bookSession("1", request)).rejects.toMatchObject({ status: 403 });
        expect(bookings.hasConflict).not.toHaveBeenCalled();
    });

    test("notifies both participants when a tutor cancels and ignores a retry", async () =>
    {
        const { service, bookings, outbox, booking } = createBookingFixture();
        // Return the canceled row on the second attempt
        bookings.lockBooking.mockResolvedValueOnce(booking)
            .mockResolvedValueOnce({ ...booking, canceledAt: "2026-11-19T12:00:00Z" });

        await expect(service.cancelSession("2", "5")).resolves.toBe(true);
        await expect(service.cancelSession("2", "5")).resolves.toBe(false);
        expect(bookings.cancelBooking).toHaveBeenCalledTimes(1);
        expect(outbox.enqueue.mock.calls).toEqual([
            ["5", "2", "booking_canceled", connection],
            ["5", "1", "booking_canceled", connection],
        ]);
    });
});
