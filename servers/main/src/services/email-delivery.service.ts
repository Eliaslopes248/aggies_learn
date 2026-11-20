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

import { type EmailOutboxEntry } from "../database/models/notifications.model.js";
import { type IBookingRepository } from "../database/repositories/interfaces/bookings.interface.js";
import { type IEmailOutboxRepository } from "../database/repositories/interfaces/email-outbox.interface.js";
import { type IUserRepository } from "../database/repositories/interfaces/users.interface.js";
import { requirePage } from "./service.utils.js";

export type EmailMessage = { to: string; subject: string; text: string; idempotencyKey?: string };

export interface EmailProvider
{
    /**
     * Submit an email to the provider.
     * @param message Recipient, subject, body, and optional idempotency key.
     */
    send(message: EmailMessage): Promise<void>;
}

export class EmailDeliveryService
{
    private timer: NodeJS.Timeout | undefined;
    private activeBatch: Promise<number> | undefined;
    private stopping = false;

    /**
     * Create an outbox worker with the configured mail provider.
     * @param outbox Repository used to load jobs and record delivery attempts.
     * @param bookings Repository used to read current booking details.
     * @param users Repository used to look up recipient email addresses.
     * @param provider Provider used to send email.
     */
    constructor(
        private readonly outbox: IEmailOutboxRepository,
        private readonly bookings: IBookingRepository,
        private readonly users: IUserRepository,
        private readonly provider: EmailProvider,
    ) {}

    /**
     * Reuse the active batch if processing is already in progress.
     * @param limit Maximum number of due jobs to read.
     * @returns Number of jobs processed by the batch.
     */
    processDueBatch(limit = 25): Promise<number>
    {
        requirePage(limit, 0);
        this.activeBatch ??= this.deliverBatch(limit).finally(() =>
        {
            this.activeBatch = undefined;
        });
        return this.activeBatch;
    }

    /**
     * Start polling the outbox for due jobs.
     */
    start(): void
    {
        this.stopping = false;
        this.timer ??= setInterval(() =>
        {
            void this.processDueBatch().catch(error => console.error("Unable to process the email outbox:", error));
        }, 5000);
    }

    /**
     * Stop polling and wait for any active delivery attempt to finish.
     */
    async stop(): Promise<void>
    {
        this.stopping = true;
        clearInterval(this.timer);
        this.timer = undefined;
        await this.activeBatch;
    }

    /**
     * Process each job once per batch and schedule unsuccessful attempts.
     * @param limit Maximum number of due jobs to read.
     * @returns Number of jobs attempted before the batch finished or stopped.
     */
    private async deliverBatch(limit: number): Promise<number>
    {
        const jobs = await this.outbox.listDue(limit);
        let processed = 0;
        for (const job of jobs)
        {
            if (this.stopping)
            {
                break;
            }

            try
            {
                await this.deliver(job);
                await this.outbox.markSent(job.id);
            }
            catch (error)
            {
                // Keep failed jobs visible and limit the retry interval
                const delay = Math.min(60 * 60_000, 30_000 * 2 ** job.attemptCount);
                const retryAt = new Date(Date.now() + delay).toISOString();
                await this.outbox.scheduleRetry(job.id, retryAt);
                if (job.attemptCount === 0)
                {
                    console.error(`Unable to deliver outbox job ${job.id}:`, error);
                }
            }
            processed++;
        }

        return processed;
    }

    /**
     * Resolve the current booking status before sending an email.
     * @param job Outbox entry identifying the booking, recipient, and event.
     */
    private async deliver(job: EmailOutboxEntry): Promise<void>
    {
        const [booking, recipient] = await Promise.all([
            this.bookings.findBooking(job.bookingId),
            this.users.findAccountById(job.recipientId),
        ]);
        if (!booking || !recipient)
        {
            throw new Error("Booking or recipient not found.");
        }

        const canceled = job.eventType === "booking_canceled" || booking.canceledAt !== null;
        const time = new Intl.DateTimeFormat("en-US", {
            dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York",
        }).format(new Date(booking.startsAt));
        await this.provider.send({
            to: recipient.email,
            subject: canceled ? "Tutoring session canceled" : "Tutoring session confirmed",
            text: canceled
                ? `Your tutoring session on ${time} Eastern time was canceled.`
                : `Your tutoring session is scheduled for ${time} Eastern time at ${booking.location}.`,
            idempotencyKey: `booking-email-${job.id}`,
        });
    }
}
