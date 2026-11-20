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

import { type Pool, type PoolConnection, type ResultSetHeader, type RowDataPacket } from "mysql2/promise";

import { type IDatabaseService } from "../../database.service.js";
import { type Booking } from "../../models/appointments.model.js";
import { type BookingSearch, type IBookingRepository, type NewBooking } from "../interfaces/bookings.interface.js";
import { getInsertedId, toMySQLDateTime } from "./repository.utils.js";

type BookingRow = RowDataPacket & Booking;

const selectBookings = `
    SELECT CAST(id AS CHAR) AS id, CAST(availability_block_id AS CHAR) AS availabilityBlockId,
           CAST(course_id AS CHAR) AS courseId, CAST(tutor_id AS CHAR) AS tutorId,
           CAST(student_id AS CHAR) AS studentId, CAST(canceled_by AS CHAR) AS canceledBy, location,
           DATE_FORMAT(starts_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS startsAt,
           DATE_FORMAT(ends_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS endsAt,
           DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS createdAt,
           DATE_FORMAT(canceled_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS canceledAt
    FROM bookings
`;

export class MySQLBookingRepository implements IBookingRepository
{
    // Create a booking repository with the shared database service. 
    constructor(private readonly database: IDatabaseService<Pool>) {}

    /** @inheritdoc */
    async findBooking(id: string): Promise<Booking | null>
    {
        const pool = await this.database.connect();
        const [[row]] = await pool.execute<BookingRow[]>(`${selectBookings} WHERE id = CAST(? AS SIGNED)`, [id]);
        return row ?? null;
    }

    /** @inheritdoc */
    async lockBooking(id: string, connection: PoolConnection): Promise<Booking | null>
    {
        const [[row]] = await connection.execute<BookingRow[]>(
            `${selectBookings} WHERE id = CAST(? AS SIGNED) FOR UPDATE`, [id],
        );
        return row ?? null;
    }

    /** @inheritdoc */
    async listBookings(filters: BookingSearch): Promise<Booking[]>
    {
        const participant = filters.participantId ?? null;
        const course = filters.courseId ?? null;
        const tutor = filters.tutorId ?? null;
        const start = filters.startsAt ? toMySQLDateTime(filters.startsAt) : null;
        const end = filters.endsAt ? toMySQLDateTime(filters.endsAt) : null;
        const pool = await this.database.connect();
        const [rows] = await pool.execute<BookingRow[]>(
            `${selectBookings}
             WHERE (? OR canceled_at IS NULL)
               AND (? = FALSE OR canceled_at IS NOT NULL)
               AND (? IS NULL OR CAST(? AS SIGNED) IN (student_id, tutor_id))
               AND (? IS NULL OR tutor_id = CAST(? AS SIGNED))
               AND (? IS NULL OR course_id = CAST(? AS SIGNED))
               AND (? IS NULL OR ends_at > ?)
               AND (? IS NULL OR starts_at < ?)
             ORDER BY starts_at, bookings.id LIMIT ? OFFSET ?`,
            [Boolean(filters.includeCanceled || filters.canceledOnly), filters.canceledOnly ?? false,
                participant, participant, tutor, tutor, course, course,
                start, start, end, end, filters.limit, filters.offset],
        );
        return rows;
    }

    /** @inheritdoc */
    async lockParticipants(studentId: string, tutorId: string, connection: PoolConnection): Promise<boolean>
    {
        // Lock account rows by numeric ID before checking either participant's schedule
        const [rows] = await connection.execute<RowDataPacket[]>(
            `SELECT id FROM accounts
             WHERE id IN (CAST(? AS SIGNED), CAST(? AS SIGNED)) ORDER BY id FOR UPDATE`,
            [studentId, tutorId],
        );
        return rows.length === 2;
    }

    /** @inheritdoc */
    async hasConflict(booking: NewBooking, connection: PoolConnection): Promise<boolean>
    {
        const { studentId, tutorId, startsAt, endsAt } = booking;
        const [rows] = await connection.execute<RowDataPacket[]>(
            `SELECT id FROM bookings
             WHERE canceled_at IS NULL AND starts_at < ? AND ends_at > ?
               AND (student_id IN (CAST(? AS SIGNED), CAST(? AS SIGNED))
                    OR tutor_id IN (CAST(? AS SIGNED), CAST(? AS SIGNED)))
             LIMIT 1`,
            [toMySQLDateTime(endsAt), toMySQLDateTime(startsAt), studentId, tutorId, studentId, tutorId],
        );
        return rows.length > 0;
    }

    /** @inheritdoc */
    async hasBookingOutsideBlock(blockId: string, startsAt: string, endsAt: string, connection: PoolConnection): Promise<boolean>
    {
        const [rows] = await connection.execute<RowDataPacket[]>(
            `SELECT id FROM bookings WHERE availability_block_id = CAST(? AS SIGNED)
             AND canceled_at IS NULL AND (starts_at < ? OR ends_at > ?) LIMIT 1`,
            [blockId, toMySQLDateTime(startsAt), toMySQLDateTime(endsAt)],
        );
        return rows.length > 0;
    }

    /** @inheritdoc */
    async createBooking(booking: NewBooking, connection: PoolConnection): Promise<string>
    {
        await connection.execute(
            `INSERT INTO bookings (availability_block_id, course_id, tutor_id, student_id, starts_at, ends_at, location)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [booking.availabilityBlockId, booking.courseId, booking.tutorId, booking.studentId,
                toMySQLDateTime(booking.startsAt), toMySQLDateTime(booking.endsAt), booking.location],
        );
        return getInsertedId(connection);
    }

    /** @inheritdoc */
    async cancelBooking(id: string, canceledBy: string, connection: PoolConnection): Promise<boolean>
    {
        const [result] = await connection.execute<ResultSetHeader>(
            `UPDATE bookings SET canceled_at = UTC_TIMESTAMP(6), canceled_by = ?
             WHERE id = CAST(? AS SIGNED) AND canceled_at IS NULL`,
            [canceledBy, id],
        );
        return result.affectedRows > 0;
    }
}
