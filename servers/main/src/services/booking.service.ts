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

import { type IAvailabilityRepository } from "../database/repositories/interfaces/availability.interface.js";
import { type BookingSearch, type IBookingRepository } from "../database/repositories/interfaces/bookings.interface.js";
import { type ICatalogRepository } from "../database/repositories/interfaces/catalog.interface.js";
import { type IEmailOutboxRepository } from "../database/repositories/interfaces/email-outbox.interface.js";
import { type ITutorAssignmentRepository } from "../database/repositories/interfaces/tutor-assignments.interface.js";
import { type IUserRepository } from "../database/repositories/interfaces/users.interface.js";
import { type RunTransaction } from "../database/transaction.js";
import { bookingLeadTimeMs, getTime, getWindow, sessionDurationMs, type TimeWindow } from "./scheduling.utils.js";
import { requireAccountRole, requireId, requirePage, ServiceError } from "./service.utils.js";

type BookingRequest = TimeWindow & { availabilityBlockId: string; tutorId: string; courseId: string };

export class BookingService
{
    /**
     * Create the booking service with its scheduling and outbox dependencies.
     * @param users Repository used to check participant roles and email verification.
     * @param catalog Repository used to check the active course hierarchy.
     * @param assignments Repository used to lock the tutor’s course assignment.
     * @param availability Repository used to lock the requested block.
     * @param bookings Repository used to check conflicts and save bookings.
     * @param outbox Repository used to queue booking email.
     * @param transaction Runner used to commit booking and email writes together.
     */
    constructor(
        private readonly users: IUserRepository,
        private readonly catalog: ICatalogRepository,
        private readonly assignments: ITutorAssignmentRepository,
        private readonly availability: IAvailabilityRepository,
        private readonly bookings: IBookingRepository,
        private readonly outbox: IEmailOutboxRepository,
        private readonly transaction: RunTransaction,
    ) {}

    /**
     * Confirm a student booking and queue the tutor email together.
     * @param studentId Signed-in student requesting the session.
     * @param input Course, tutor, availability block, and requested UTC times.
     * @returns ID of the confirmed booking.
     */
    async bookSession(studentId: string, input: BookingRequest): Promise<string>
    {
        requireId(studentId);
        const { tutorId, courseId, availabilityBlockId } = input;
        [tutorId, courseId, availabilityBlockId].forEach(requireId);
        const { start, end } = getWindow(input);
        if (studentId === tutorId || end - start !== sessionDurationMs || start < Date.now() + bookingLeadTimeMs)
        {
            throw new ServiceError(400, "Invalid booking time or participants.");
        }

        return this.transaction(async connection =>
        {
            if (!await this.bookings.lockParticipants(studentId, tutorId, connection))
            {
                throw new ServiceError(404, "Booking participant not found.");
            }

            await requireAccountRole(this.users, studentId, "student", connection);
            await requireAccountRole(this.users, tutorId, "tutor", connection);
            const student = await this.users.findAccountById(studentId, connection);
            if (!student?.emailVerifiedAt)
            {
                throw new ServiceError(403, "Verify your email before booking.");
            }

            if (!await this.catalog.isCourseActive(courseId, connection))
            {
                throw new ServiceError(404, "Course not found.");
            }

            const assignment = await this.assignments.lockAssignment(tutorId, courseId, connection);
            const block = await this.availability.lockBlock(availabilityBlockId, connection);
            if (!assignment || assignment.deactivatedAt || !block || block.withdrawnAt ||
                block.tutorId !== tutorId || start < getTime(block.startsAt) || end > getTime(block.endsAt) ||
                (start - getTime(block.startsAt)) % sessionDurationMs !== 0 ||
                start < Date.now() + bookingLeadTimeMs)
            {
                throw new ServiceError(409, "The requested slot is no longer available.");
            }

            const booking = {
                availabilityBlockId, courseId, tutorId, studentId,
                startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString(), location: block.location,
            };
            if (await this.bookings.hasConflict(booking, connection))
            {
                throw new ServiceError(409, "A participant already has a booking at that time.");
            }

            const id = await this.bookings.createBooking(booking, connection);
            await this.outbox.enqueue(id, tutorId, "booking_confirmed", connection);
            return id;
        });
    }

    /**
     * Cancel an upcoming booking and queue its notices once.
     * @param actorId Account requesting the cancellation.
     * @param bookingId Upcoming booking to cancel.
     * @returns Whether the booking was canceled by this call.
     */
    async cancelSession(actorId: string, bookingId: string): Promise<boolean>
    {
        requireId(actorId);
        const current = await this.bookings.findBooking(requireId(bookingId));
        if (!current)
        {
            throw new ServiceError(404, "Booking not found.");
        }

        if (actorId !== current.studentId && actorId !== current.tutorId)
        {
            await requireAccountRole(this.users, actorId, "admin");
        }

        return this.transaction(async connection =>
        {
            await this.bookings.lockParticipants(current.studentId, current.tutorId, connection);
            const booking = await this.bookings.lockBooking(bookingId, connection);
            if (!booking || booking.canceledAt)
            {
                return false;
            }

            if (getTime(booking.startsAt) <= Date.now())
            {
                throw new ServiceError(409, "Only upcoming bookings can be canceled.");
            }

            await this.bookings.cancelBooking(bookingId, actorId, connection);
            await this.outbox.enqueue(bookingId, booking.tutorId, "booking_canceled", connection);
            if (actorId !== booking.studentId)
            {
                await this.outbox.enqueue(bookingId, booking.studentId, "booking_canceled", connection);
            }

            return true;
        });
    }

    /**
     * List bookings owned by the signed-in participant.
     * @param accountId Signed-in participant whose sessions are requested.
     * @param filters Date, course, tutor, cancellation, and pagination filters.
     * @returns Matching bookings for the participant.
     */
    listMySessions(accountId: string, filters: Omit<BookingSearch, "participantId">)
    {
        return this.listSessions({ ...filters, participantId: requireId(accountId) });
    }

    /**
     * List bookings for an admin support view.
     * @param adminId Admin requesting the booking list.
     * @param filters Participant, schedule, and pagination filters.
     * @returns Matching bookings.
     */
    async listAdminSessions(adminId: string, filters: BookingSearch)
    {
        await requireAccountRole(this.users, adminId, "admin");
        return this.listSessions(filters);
    }

    /**
     * Validate booking list filters before querying.
     * @param filters Booking filters and pagination settings.
     * @returns Matching bookings after filter validation.
     */
    private listSessions(filters: BookingSearch)
    {
        requirePage(filters.limit, filters.offset);
        [filters.participantId, filters.tutorId, filters.courseId]
            .filter(id => id !== undefined)
            .forEach(requireId);
        if (filters.startsAt !== undefined && filters.endsAt !== undefined)
        {
            getWindow({ startsAt: filters.startsAt, endsAt: filters.endsAt });
        }
        else if (filters.startsAt !== undefined || filters.endsAt !== undefined)
        {
            throw new ServiceError(400, "Provide both calendar window bounds.");
        }

        return this.bookings.listBookings(filters);
    }
}
