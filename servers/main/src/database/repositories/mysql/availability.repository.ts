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
import { type AvailabilityBlock } from "../../models/appointments.model.js";
import { type AvailabilityDetails, type IAvailabilityRepository } from "../interfaces/availability.interface.js";
import { getInsertedId, toMySQLDateTime } from "./repository.utils.js";

type AvailabilityRow = RowDataPacket & AvailabilityBlock;

const selectBlocks = `
    SELECT CAST(id AS CHAR) AS id, CAST(tutor_id AS CHAR) AS tutorId, location,
           DATE_FORMAT(starts_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS startsAt,
           DATE_FORMAT(ends_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS endsAt,
           DATE_FORMAT(withdrawn_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS withdrawnAt
    FROM availability_blocks
`;

export class MySQLAvailabilityRepository implements IAvailabilityRepository
{
    // Create an availability repository with the shared database service. 
    constructor(private readonly database: IDatabaseService<Pool>) {}

    /** @inheritdoc */
    async createBlock(tutorId: string, block: AvailabilityDetails): Promise<string>
    {
        const pool = await this.database.connect();
        const connection = await pool.getConnection();
        try
        {
            await connection.execute(
                "INSERT INTO availability_blocks (tutor_id, starts_at, ends_at, location) VALUES (?, ?, ?, ?)",
                [tutorId, toMySQLDateTime(block.startsAt), toMySQLDateTime(block.endsAt), block.location],
            );
            return await getInsertedId(connection);
        }
        finally
        {
            connection.release();
        }
    }

    /** @inheritdoc */
    async findBlock(id: string): Promise<AvailabilityBlock | null>
    {
        const pool = await this.database.connect();
        const [[row]] = await pool.execute<AvailabilityRow[]>(`${selectBlocks} WHERE id = CAST(? AS SIGNED)`, [id]);
        return row ?? null;
    }

    /** @inheritdoc */
    async lockBlock(id: string, connection: PoolConnection): Promise<AvailabilityBlock | null>
    {
        const [[row]] = await connection.execute<AvailabilityRow[]>(
            `${selectBlocks} WHERE id = CAST(? AS SIGNED) FOR UPDATE`, [id],
        );
        return row ?? null;
    }

    /** @inheritdoc */
    async listBlocks(tutorId: string, startsAt: string, endsAt: string, includeWithdrawn = false): Promise<AvailabilityBlock[]>
    {
        const pool = await this.database.connect();
        const [rows] = await pool.execute<AvailabilityRow[]>(
            `${selectBlocks} WHERE tutor_id = CAST(? AS SIGNED)
             AND starts_at < ? AND ends_at > ? AND (? OR withdrawn_at IS NULL)
             ORDER BY starts_at, availability_blocks.id`,
            [tutorId, toMySQLDateTime(endsAt), toMySQLDateTime(startsAt), includeWithdrawn],
        );
        return rows;
    }

    /** @inheritdoc */
    async updateBlock(id: string, tutorId: string, block: AvailabilityDetails, connection: PoolConnection): Promise<boolean>
    {
        const [result] = await connection.execute<ResultSetHeader>(
            `UPDATE availability_blocks SET starts_at = ?, ends_at = ?, location = ?
             WHERE id = CAST(? AS SIGNED) AND tutor_id = CAST(? AS SIGNED) AND withdrawn_at IS NULL`,
            [toMySQLDateTime(block.startsAt), toMySQLDateTime(block.endsAt), block.location, id, tutorId],
        );
        return result.affectedRows > 0;
    }

    /** @inheritdoc */
    async withdrawBlock(id: string, tutorId: string, connection: PoolConnection): Promise<boolean>
    {
        const [result] = await connection.execute<ResultSetHeader>(
            `UPDATE availability_blocks SET withdrawn_at = UTC_TIMESTAMP(6)
             WHERE id = CAST(? AS SIGNED) AND tutor_id = CAST(? AS SIGNED) AND withdrawn_at IS NULL`,
            [id, tutorId],
        );
        return result.affectedRows > 0;
    }
}
