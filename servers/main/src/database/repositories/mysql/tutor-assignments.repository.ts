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
import { type TutorCourseAssignment } from "../../models/tutoring.model.js";
import { type ITutorAssignmentRepository } from "../interfaces/tutor-assignments.interface.js";

type AssignmentRow = RowDataPacket & TutorCourseAssignment;

const selectAssignments = `
    SELECT CAST(tutor_id AS CHAR) AS tutorId, CAST(course_id AS CHAR) AS courseId,
           CAST(assigned_by AS CHAR) AS assignedBy,
           DATE_FORMAT(assigned_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS assignedAt,
           DATE_FORMAT(deactivated_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS deactivatedAt
    FROM tutor_course_assignments
`;
const assignmentPair = "tutor_id = CAST(? AS SIGNED) AND course_id = CAST(? AS SIGNED)";

export class MySQLTutorAssignmentRepository implements ITutorAssignmentRepository
{
    /** Create a tutor assignment repository with the shared database service. */
    constructor(private readonly database: IDatabaseService<Pool>) {}

    /** @inheritdoc */
    async findAssignment(tutorId: string, courseId: string): Promise<TutorCourseAssignment | null>
    {
        const pool = await this.database.connect();
        const [[row]] = await pool.execute<AssignmentRow[]>(
            `${selectAssignments} WHERE ${assignmentPair}`, [tutorId, courseId],
        );
        return row ?? null;
    }

    /** @inheritdoc */
    async lockAssignment(tutorId: string, courseId: string, connection: PoolConnection): Promise<TutorCourseAssignment | null>
    {
        const [[row]] = await connection.execute<AssignmentRow[]>(
            `${selectAssignments} WHERE ${assignmentPair} FOR UPDATE`, [tutorId, courseId],
        );
        return row ?? null;
    }

    /** @inheritdoc */
    async listByCourse(courseId: string, includeDeactivated = false, connection?: PoolConnection): Promise<TutorCourseAssignment[]>
    {
        const executor = connection ?? await this.database.connect();
        const [rows] = await executor.execute<AssignmentRow[]>(
            `${selectAssignments} WHERE course_id = CAST(? AS SIGNED)
             AND (? OR deactivated_at IS NULL) ORDER BY tutor_course_assignments.tutor_id`,
            [courseId, includeDeactivated],
        );
        return rows;
    }

    /** @inheritdoc */
    async listByTutor(tutorId: string, includeDeactivated = false): Promise<TutorCourseAssignment[]>
    {
        const pool = await this.database.connect();
        const [rows] = await pool.execute<AssignmentRow[]>(
            `${selectAssignments} WHERE tutor_id = CAST(? AS SIGNED)
             AND (? OR deactivated_at IS NULL) ORDER BY tutor_course_assignments.course_id`,
            [tutorId, includeDeactivated],
        );
        return rows;
    }

    /** @inheritdoc */
    async assign(tutorId: string, courseId: string, adminId: string, connection?: PoolConnection): Promise<void>
    {
        const executor = connection ?? await this.database.connect();

        // Keep assignment metadata on retries and replace it on reactivation
        await executor.execute(
            `INSERT INTO tutor_course_assignments (tutor_id, course_id, assigned_by)
             VALUES (?, ?, ?) AS incoming
             ON DUPLICATE KEY UPDATE
                 assigned_by = IF(deactivated_at IS NULL, tutor_course_assignments.assigned_by, incoming.assigned_by),
                 assigned_at = IF(deactivated_at IS NULL, tutor_course_assignments.assigned_at, UTC_TIMESTAMP(6)),
                 deactivated_at = NULL`,
            [tutorId, courseId, adminId],
        );
    }

    /** @inheritdoc */
    async deactivate(tutorId: string, courseId: string, connection?: PoolConnection): Promise<boolean>
    {
        const executor = connection ?? await this.database.connect();
        const [result] = await executor.execute<ResultSetHeader>(
            `UPDATE tutor_course_assignments SET deactivated_at = UTC_TIMESTAMP(6)
             WHERE ${assignmentPair} AND deactivated_at IS NULL`,
            [tutorId, courseId],
        );
        return result.affectedRows > 0;
    }
}
