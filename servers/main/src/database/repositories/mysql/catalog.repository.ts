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
import { type College, type Course, type Department } from "../../models/academic.model.js";
import { type CourseDetails, type CourseSearch, type ICatalogRepository } from "../interfaces/catalog.interface.js";
import { getInsertedId } from "./repository.utils.js";

// Select IDs and UTC timestamps as strings
const collegeColumns = `CAST(id AS CHAR) AS id, name,
    DATE_FORMAT(archived_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS archivedAt`;
const departmentColumns = `${collegeColumns}, CAST(college_id AS CHAR) AS collegeId`;
const courseColumns = `CAST(c.id AS CHAR) AS id, CAST(c.department_id AS CHAR) AS departmentId,
    c.subject_code AS subjectCode, c.course_number AS courseNumber, c.title,
    DATE_FORMAT(c.archived_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS archivedAt`;

const courseHierarchy = `FROM courses c
    JOIN departments d ON d.id = c.department_id
    JOIN colleges col ON col.id = d.college_id`;
const activeCourse = "c.archived_at IS NULL AND d.archived_at IS NULL AND col.archived_at IS NULL";

export class MySQLCatalogRepository implements ICatalogRepository
{
    /** Create a catalog repository with the shared database service. */
    constructor(private readonly database: IDatabaseService<Pool>) {}

    /** @inheritdoc */
    async findCollege(id: string): Promise<College | null>
    {
        const pool = await this.database.connect();
        const [[row]] = await pool.execute<(RowDataPacket & College)[]>(
            `SELECT ${collegeColumns} FROM colleges WHERE id = CAST(? AS SIGNED)`,
            [id],
        );
        return row ?? null;
    }

    /** @inheritdoc */
    async findDepartment(id: string): Promise<Department | null>
    {
        const pool = await this.database.connect();
        const [[row]] = await pool.execute<(RowDataPacket & Department)[]>(
            `SELECT ${departmentColumns} FROM departments WHERE id = CAST(? AS SIGNED)`,
            [id],
        );
        return row ?? null;
    }

    /** @inheritdoc */
    async findCourse(id: string, connection?: PoolConnection): Promise<Course | null>
    {
        const executor = connection ?? await this.database.connect();
        const [[row]] = await executor.execute<(RowDataPacket & Course)[]>(
            `SELECT ${courseColumns} FROM courses c WHERE c.id = CAST(? AS SIGNED)`,
            [id],
        );
        return row ?? null;
    }

    /** @inheritdoc */
    async isCourseActive(id: string, connection: PoolConnection): Promise<boolean>
    {
        const [rows] = await connection.execute<RowDataPacket[]>(
            `SELECT c.id ${courseHierarchy} WHERE c.id = CAST(? AS SIGNED) AND ${activeCourse} FOR SHARE`,
            [id],
        );
        return rows.length > 0;
    }

    /** @inheritdoc */
    async listColleges(includeArchived = false): Promise<College[]>
    {
        const pool = await this.database.connect();
        const [rows] = await pool.execute<(RowDataPacket & College)[]>(
            `SELECT ${collegeColumns} FROM colleges WHERE (? OR archived_at IS NULL) ORDER BY name, id`,
            [includeArchived],
        );
        return rows;
    }

    /** @inheritdoc */
    async listDepartments(collegeId: string, includeArchived = false): Promise<Department[]>
    {
        const pool = await this.database.connect();
        const [rows] = await pool.execute<(RowDataPacket & Department)[]>(
            `SELECT ${departmentColumns} FROM departments
             WHERE college_id = CAST(? AS SIGNED)
               AND (? OR (archived_at IS NULL AND EXISTS (
                   SELECT 1 FROM colleges WHERE colleges.id = departments.college_id AND archived_at IS NULL
               )))
             ORDER BY name, id`,
            [collegeId, includeArchived],
        );
        return rows;
    }

    /** @inheritdoc */
    async searchCourses(filters: CourseSearch): Promise<Course[]>
    {
        const collegeId = filters.collegeId ?? null;
        const departmentId = filters.departmentId ?? null;
        const search = filters.search?.trim() || null;
        const pool = await this.database.connect();
        const [rows] = await pool.execute<(RowDataPacket & Course)[]>(
            `SELECT ${courseColumns} ${courseHierarchy}
             WHERE (? OR (${activeCourse}))
               AND (? IS NULL OR col.id = CAST(? AS SIGNED))
               AND (? IS NULL OR d.id = CAST(? AS SIGNED))
               AND (? IS NULL OR LOCATE(?, CONCAT(c.subject_code, ' ', c.course_number, ' ', c.title)) > 0)
             ORDER BY c.subject_code, c.course_number, c.id
             LIMIT ? OFFSET ?`,
            [filters.includeArchived ?? false, collegeId, collegeId, departmentId, departmentId,
                search, search, filters.limit, filters.offset],
        );
        return rows;
    }

    /** @inheritdoc */
    createCollege(name: string): Promise<string>
    {
        return this.insert("INSERT INTO colleges (name) VALUES (?)", [name]);
    }

    /** @inheritdoc */
    updateCollege(id: string, name: string): Promise<boolean>
    {
        return this.update("UPDATE colleges SET name = ? WHERE id = CAST(? AS SIGNED)", [name, id]);
    }

    /** @inheritdoc */
    archiveCollege(id: string): Promise<boolean>
    {
        return this.update("UPDATE colleges SET archived_at = UTC_TIMESTAMP(6) WHERE id = CAST(? AS SIGNED) AND archived_at IS NULL", [id]);
    }

    /** @inheritdoc */
    createDepartment(collegeId: string, name: string): Promise<string>
    {
        return this.insert("INSERT INTO departments (college_id, name) VALUES (?, ?)", [collegeId, name]);
    }

    /** @inheritdoc */
    updateDepartment(id: string, collegeId: string, name: string): Promise<boolean>
    {
        return this.update("UPDATE departments SET college_id = ?, name = ? WHERE id = CAST(? AS SIGNED)", [collegeId, name, id]);
    }

    /** @inheritdoc */
    archiveDepartment(id: string): Promise<boolean>
    {
        return this.update("UPDATE departments SET archived_at = UTC_TIMESTAMP(6) WHERE id = CAST(? AS SIGNED) AND archived_at IS NULL", [id]);
    }

    /** @inheritdoc */
    createCourse(course: CourseDetails, connection?: PoolConnection): Promise<string>
    {
        return this.insert("INSERT INTO courses (department_id, subject_code, course_number, title) VALUES (?, ?, ?, ?)", [course.departmentId, course.subjectCode, course.courseNumber, course.title], connection);
    }

    /** @inheritdoc */
    updateCourse(id: string, course: CourseDetails): Promise<boolean>
    {
        return this.update("UPDATE courses SET department_id = ?, subject_code = ?, course_number = ?, title = ? WHERE id = CAST(? AS SIGNED)", [course.departmentId, course.subjectCode, course.courseNumber, course.title, id]);
    }

    /** @inheritdoc */
    archiveCourse(id: string): Promise<boolean>
    {
        return this.update("UPDATE courses SET archived_at = UTC_TIMESTAMP(6) WHERE id = CAST(? AS SIGNED) AND archived_at IS NULL", [id]);
    }

    /**
     * Insert a catalog row and return its generated ID.
     * @param sql Insert statement.
     * @param values Statement parameters.
     */
    private async insert(sql: string, values: string[], transaction?: PoolConnection): Promise<string>
    {
        if (transaction)
        {
            await transaction.execute(sql, values);
            return getInsertedId(transaction);
        }

        const pool = await this.database.connect();
        const connection = await pool.getConnection();
        try
        {
            await connection.execute(sql, values);
            return await getInsertedId(connection);
        }
        finally
        {
            connection.release();
        }
    }

    /**
     * Run a catalog update and report whether it matched a row.
     * @param sql Update statement.
     * @param values Statement parameters.
     */
    private async update(sql: string, values: string[]): Promise<boolean>
    {
        const pool = await this.database.connect();
        const [result] = await pool.execute<ResultSetHeader>(sql, values);
        return result.affectedRows > 0;
    }
}
