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

import { type AvailabilityDetails, type IAvailabilityRepository } from "../database/repositories/interfaces/availability.interface.js";
import { type IBookingRepository } from "../database/repositories/interfaces/bookings.interface.js";
import { type ICatalogRepository } from "../database/repositories/interfaces/catalog.interface.js";
import { type ITutorAssignmentRepository } from "../database/repositories/interfaces/tutor-assignments.interface.js";
import { type IUserRepository } from "../database/repositories/interfaces/users.interface.js";
import { type RunTransaction } from "../database/transaction.js";
import { bookingLeadTimeMs, getTime, getWindow, sessionDurationMs, type TimeWindow } from "./scheduling.utils.js";
import { requireAccountRole, requireId, requireText, ServiceError } from "./service.utils.js";

type BookableSlot = TimeWindow & { tutorId: string; availabilityBlockId: string };

export class AvailabilityService
{
    /**
     * Create the availability service with its calendar dependencies.
     * @param users Repository used to check account roles.
     * @param catalog Repository used to check active courses.
     * @param assignments Repository used to find tutor course assignments.
     * @param availability Repository used to read and write availability blocks.
     * @param bookings Repository used to check occupied time.
     * @param transaction Runner used for locking reads and writes.
     */
    constructor(
        private readonly users: IUserRepository,
        private readonly catalog: ICatalogRepository,
        private readonly assignments: ITutorAssignmentRepository,
        private readonly availability: IAvailabilityRepository,
        private readonly bookings: IBookingRepository,
        private readonly transaction: RunTransaction,
    ) {}

    /**
     * Publish availability for a tutor with an active course assignment.
     * @param tutorId Tutor publishing the block.
     * @param input UTC start, UTC end, and session location.
     * @returns ID of the new block.
     */
    async createBlock(tutorId: string, input: AvailabilityDetails): Promise<string>
    {
        await requireAccountRole(this.users, tutorId, "tutor");
        const assignments = await this.assignments.listByTutor(tutorId);
        for (const assignment of assignments)
        {
            if (await this.transaction(connection => this.catalog.isCourseActive(assignment.courseId, connection)))
            {
                return this.availability.createBlock(tutorId, this.validateBlock(input));
            }
        }

        throw new ServiceError(403, "An active course assignment is required.");
    }

    /**
     * Read the tutor's calendar for the owner or an admin.
     * @param actorId Account requesting calendar access.
     * @param tutorId Tutor whose calendar is requested.
     * @param window UTC calendar window.
     * @returns Open availability blocks and the tutor’s confirmed bookings.
     */
    async listTutorCalendar(actorId: string, tutorId: string, window: TimeWindow)
    {
        requireId(tutorId);
        await requireAccountRole(this.users, actorId, actorId === tutorId ? "tutor" : "admin");
        getWindow(window);
        const [blocks, bookings] = await Promise.all([
            this.availability.listBlocks(tutorId, window.startsAt, window.endsAt),
            this.listCalendarBookings(tutorId, window),
        ]);

        return { blocks, bookings: bookings.filter(booking => booking.tutorId === tutorId) };
    }

    /**
     * Find future, unoccupied slots for active tutors in a course.
     * @param courseId Course the student wants tutoring for.
     * @param window UTC calendar window to search.
     * @returns Future slots ordered by start time.
     */
    async listBookableSlots(courseId: string, window: TimeWindow): Promise<BookableSlot[]>
    {
        requireId(courseId);
        const { start, end } = getWindow(window);
        const earliest = Math.max(start, Date.now() + bookingLeadTimeMs);
        const assignments = await this.transaction(async connection =>
        {
            if (!await this.catalog.isCourseActive(courseId, connection))
            {
                throw new ServiceError(404, "Course not found.");
            }

            return this.assignments.listByCourse(courseId, false, connection);
        });

        const slots: BookableSlot[] = [];
        for (const { tutorId } of assignments)
        {
            const roles = await this.users.listRoles(tutorId);
            if (!roles.includes("tutor"))
            {
                continue;
            }

            const [blocks, bookings] = await Promise.all([
                this.availability.listBlocks(tutorId, window.startsAt, window.endsAt),
                this.listCalendarBookings(tutorId, window),
            ]);
            const occupied = bookings.map(booking => ({
                start: getTime(booking.startsAt), end: getTime(booking.endsAt),
            }));
            const seenStarts = new Set<number>();
            for (const block of blocks)
            {
                const blockStart = getTime(block.startsAt);
                const blockEnd = Math.min(end, getTime(block.endsAt));
                const offset = Math.max(0, Math.ceil((earliest - blockStart) / sessionDurationMs));

                for (let slot = blockStart + offset * sessionDurationMs; slot + sessionDurationMs <= blockEnd; slot += sessionDurationMs)
                {
                    const slotEnd = slot + sessionDurationMs;
                    if (seenStarts.has(slot) || occupied.some(time => time.start < slotEnd && time.end > slot))
                    {
                        continue;
                    }

                    seenStarts.add(slot);
                    slots.push({
                        tutorId,
                        availabilityBlockId: block.id,
                        startsAt: new Date(slot).toISOString(),
                        endsAt: new Date(slotEnd).toISOString(),
                    });
                }
            }
        }

        return slots.sort((left, right) => left.startsAt.localeCompare(right.startsAt));
    }

    /**
     * Edit an owned block while preserving confirmed booking times.
     * @param tutorId Tutor who owns the block.
     * @param blockId Block to update.
     * @param input Replacement times and location.
     */
    async updateBlock(tutorId: string, blockId: string, input: AvailabilityDetails): Promise<void>
    {
        await requireAccountRole(this.users, tutorId, "tutor");
        requireId(blockId);
        const details = this.validateBlock(input);

        await this.transaction(async connection =>
        {
            const block = await this.availability.lockBlock(blockId, connection);
            if (!block || block.withdrawnAt || block.tutorId !== tutorId)
            {
                throw new ServiceError(404, "Open availability block not found.");
            }

            if (await this.bookings.hasBookingOutsideBlock(blockId, details.startsAt, details.endsAt, connection))
            {
                throw new ServiceError(409, "The edit would remove confirmed booking time.");
            }

            await this.availability.updateBlock(blockId, tutorId, details, connection);
        });
    }

    /**
     * Withdraw an owned block while preserving its existing bookings.
     * @param tutorId Tutor who owns the block.
     * @param blockId Block to withdraw.
     * @returns Whether an open block was withdrawn.
     */
    async withdrawBlock(tutorId: string, blockId: string): Promise<boolean>
    {
        await requireAccountRole(this.users, tutorId, "tutor");
        return this.transaction(connection => this.availability.withdrawBlock(requireId(blockId), tutorId, connection));
    }

    /**
     * Read all pages of bookings for a bounded calendar window.
     * @param accountId Participant whose bookings are needed.
     * @param window UTC calendar window to search.
     * @returns Uncanceled bookings across all pages and both participant roles.
     */
    private async listCalendarBookings(accountId: string, window: TimeWindow)
    {
        const bookings = [];
        const limit = 100;
        for (let offset = 0; ; offset += limit)
        {
            const page = await this.bookings.listBookings({ ...window, participantId: accountId, limit, offset });
            bookings.push(...page);
            if (page.length < limit)
            {
                return bookings;
            }
        }
    }

    /**
     * Validate a block and normalize its times before persistence.
     * @param input Availability times and location to validate.
     * @returns Normalized UTC times and a trimmed location.
     */
    private validateBlock(input: AvailabilityDetails): AvailabilityDetails
    {
        const { start, end } = getWindow(input);
        if (end - start < sessionDurationMs)
        {
            throw new ServiceError(400, "The block must fit at least one session.");
        }

        return {
            startsAt: new Date(start).toISOString(),
            endsAt: new Date(end).toISOString(),
            location: requireText(input.location, 2048, "Location"),
        };
    }
}
