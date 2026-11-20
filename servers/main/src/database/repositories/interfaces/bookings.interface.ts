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

import { type PoolConnection } from "mysql2/promise";
import { type Booking } from "../../models/appointments.model.js";

// Filters for participant schedules and admin booking lists
export interface BookingSearch
{
    participantId?: string;
    tutorId?: string;
    courseId?: string;
    startsAt?: string;
    endsAt?: string;
    includeCanceled?: boolean;
    canceledOnly?: boolean;
    limit: number;
    offset: number;
}

export type NewBooking = Omit<Booking, "id" | "createdAt" | "canceledAt" | "canceledBy">;

export interface IBookingRepository
{
    /** Find a booking by ID. */
    findBooking(id: string): Promise<Booking | null>;

    /** Lock a booking before canceling it. */
    lockBooking(id: string, connection: PoolConnection): Promise<Booking | null>;

    /** List bookings with stable pagination. */
    listBookings(filters: BookingSearch): Promise<Booking[]>;

    /** Lock participant accounts in ID order before checking conflicts. */
    lockParticipants(studentId: string, tutorId: string, connection: PoolConnection): Promise<boolean>;

    /** Check whether either participant has an overlapping booking. */
    hasConflict(booking: NewBooking, connection: PoolConnection): Promise<boolean>;

    /** Check whether an edit would remove time that is already booked. */
    hasBookingOutsideBlock(blockId: string, startsAt: string, endsAt: string, connection: PoolConnection): Promise<boolean>;

    /** Insert a booking and return its ID within the caller’s transaction. */
    createBooking(booking: NewBooking, connection: PoolConnection): Promise<string>;

    /** Cancel a booking once within the caller’s transaction. */
    cancelBooking(id: string, canceledBy: string, connection: PoolConnection): Promise<boolean>;
}
