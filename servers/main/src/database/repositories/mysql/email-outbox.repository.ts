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
import { type EmailOutboxEntry, type EmailOutboxEventType } from "../../models/notifications.model.js";
import { type IEmailOutboxRepository } from "../interfaces/email-outbox.interface.js";
import { toMySQLDateTime } from "./repository.utils.js";

export class MySQLEmailOutboxRepository implements IEmailOutboxRepository
{
    // Create an email outbox repository with the shared database service.
    constructor(private readonly database: IDatabaseService<Pool>) {}

    /** @inheritdoc */
    async enqueue(bookingId: string, recipientId: string, eventType: EmailOutboxEventType, connection: PoolConnection): Promise<void>
    {
        // A retry leaves the original email job and its delivery state intact
        await connection.execute(
            `INSERT INTO email_outbox (booking_id, recipient_id, event_type) VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE id = email_outbox.id`,
            [bookingId, recipientId, eventType],
        );
    }

    /** @inheritdoc */
    async listDue(limit: number): Promise<EmailOutboxEntry[]>
    {
        const pool = await this.database.connect();
        const [rows] = await pool.execute<(RowDataPacket & EmailOutboxEntry)[]>(
            `SELECT CAST(id AS CHAR) AS id, CAST(booking_id AS CHAR) AS bookingId,
                    CAST(recipient_id AS CHAR) AS recipientId, event_type AS eventType,
                    DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS createdAt,
                    DATE_FORMAT(next_attempt_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS nextAttemptAt,
                    attempt_count AS attemptCount,
                    DATE_FORMAT(sent_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS sentAt
             FROM email_outbox WHERE sent_at IS NULL AND next_attempt_at <= UTC_TIMESTAMP(6)
             ORDER BY next_attempt_at, email_outbox.id LIMIT ?`,
            [limit],
        );
        return rows;
    }

    /** @inheritdoc */
    async markSent(id: string): Promise<boolean>
    {
        const pool = await this.database.connect();
        const [result] = await pool.execute<ResultSetHeader>(
            "UPDATE email_outbox SET sent_at = UTC_TIMESTAMP(6) WHERE id = CAST(? AS SIGNED) AND sent_at IS NULL",
            [id],
        );
        return result.affectedRows > 0;
    }

    /** @inheritdoc */
    async scheduleRetry(id: string, nextAttemptAt: string): Promise<boolean>
    {
        const pool = await this.database.connect();
        const [result] = await pool.execute<ResultSetHeader>(
            `UPDATE email_outbox SET attempt_count = attempt_count + 1, next_attempt_at = ?
             WHERE id = CAST(? AS SIGNED) AND sent_at IS NULL`,
            [toMySQLDateTime(nextAttemptAt), id],
        );
        return result.affectedRows > 0;
    }
}
