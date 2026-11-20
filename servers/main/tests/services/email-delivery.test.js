import { afterEach, expect, jest, test } from "@jest/globals";

import { EmailDeliveryService } from "../../dist/services/email-delivery.service.js";

const job = { id: "1", bookingId: "2", recipientId: "3", eventType: "booking_confirmed", attemptCount: 1 };

/** Create an outbox worker with an injectable delivery result. */
function createWorker(jobToDeliver = job, bookingChanges = {})
{
    const outbox = {
        listDue: jest.fn().mockResolvedValue([jobToDeliver]),
        markSent: jest.fn().mockResolvedValue(true),
        scheduleRetry: jest.fn().mockResolvedValue(true),
    };
    const bookings = { findBooking: jest.fn().mockResolvedValue({
        startsAt: "2026-11-20T15:00:00Z", location: "Library", canceledAt: null, ...bookingChanges,
    }) };
    const users = { findAccountById: jest.fn().mockResolvedValue({ email: "tutor@example.test" }) };
    const provider = { send: jest.fn().mockResolvedValue(undefined) };
    return { outbox, provider, service: new EmailDeliveryService(outbox, bookings, users, provider) };
}

afterEach(() => jest.restoreAllMocks());

test("sends a confirmation and marks it sent after delivery", async () =>
{
    const { service, provider, outbox } = createWorker();
    // Check the outbox state while delivery is still in progress
    provider.send.mockImplementation(async () => expect(outbox.markSent).not.toHaveBeenCalled());

    await expect(service.processDueBatch()).resolves.toBe(1);
    expect(provider.send).toHaveBeenCalledWith(expect.objectContaining({
        to: "tutor@example.test", subject: "Tutoring session confirmed", idempotencyKey: "booking-email-1",
    }));
    expect(outbox.markSent).toHaveBeenCalledWith(job.id);
});

test("uses the current cancellation status when a confirmation is still queued", async () =>
{
    const { service, provider } = createWorker(job, { canceledAt: "2026-11-19T00:00:00Z" });

    await service.processDueBatch();
    expect(provider.send).toHaveBeenCalledWith(expect.objectContaining({ subject: "Tutoring session canceled" }));
});

test("schedules a retry after a provider failure", async () =>
{
    // Freeze the clock so the retry timestamp can be compared exactly
    jest.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-19T12:00:00Z"));
    const { service, provider, outbox } = createWorker();
    provider.send.mockRejectedValue(new Error("Temporary SMTP failure"));

    await service.processDueBatch();
    expect(outbox.markSent).not.toHaveBeenCalled();
    expect(outbox.scheduleRetry).toHaveBeenCalledWith(job.id, "2026-11-19T12:01:00.000Z");
});

test("shares one active batch across overlapping requests", async () =>
{
    const { service, provider, outbox } = createWorker();

    const first = service.processDueBatch();
    const second = service.processDueBatch();
    expect(first).toBe(second);

    await Promise.all([first, second]);
    expect(outbox.listDue).toHaveBeenCalledTimes(1);
    expect(provider.send).toHaveBeenCalledTimes(1);
});
