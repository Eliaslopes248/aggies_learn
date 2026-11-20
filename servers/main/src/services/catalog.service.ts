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

import { type CourseDetails, type CourseSearch, type ICatalogRepository } from "../database/repositories/interfaces/catalog.interface.js";
import { type IUserRepository } from "../database/repositories/interfaces/users.interface.js";
import { type RunTransaction } from "../database/transaction.js";
import { requireAccountRole, requireId, requirePage, requireText, ServiceError } from "./service.utils.js";

type CatalogEntry =
    | { kind: "college"; name: string }
    | { kind: "department"; name: string; collegeId: string }
    | ({ kind: "course" } & CourseDetails);

export class CatalogService
{
    /**
     * Create the catalog service with its repositories and transaction runner.
     * @param catalog Repository used to read and write the academic catalog.
     * @param users Repository used to check admin access.
     * @param transaction Runner used for catalog checks and bulk imports.
     */
    constructor(
        private readonly catalog: ICatalogRepository,
        private readonly users: IUserRepository,
        private readonly transaction: RunTransaction,
    ) {}

    /**
     * List colleges for student browsing.
     * @param adminId Optional admin account ID to include archived colleges.
     * @returns Colleges visible to the caller.
     */
    async listColleges(adminId?: string)
    {
        if (adminId !== undefined)
        {
            await requireAccountRole(this.users, adminId, "admin");
        }

        return this.catalog.listColleges(adminId !== undefined);
    }

    /**
     * List active departments in a college.
     * @param collegeId College whose departments are requested.
     * @param adminId Optional admin account ID to include archived entries.
     * @returns Departments visible to the caller.
     */
    async listDepartments(collegeId: string, adminId?: string)
    {
        if (adminId !== undefined)
        {
            await requireAccountRole(this.users, adminId, "admin");
        }

        return this.catalog.listDepartments(requireId(collegeId), adminId !== undefined);
    }

    /**
     * Search the active catalog or include archives for an admin.
     * @param filters Search terms, hierarchy filters, and pagination settings.
     * @param adminId Admin account ID required when including archived courses.
     * @returns Courses matching the filters.
     */
    async searchCourses(filters: CourseSearch, adminId?: string)
    {
        requirePage(filters.limit, filters.offset);
        if (filters.collegeId !== undefined)
        {
            requireId(filters.collegeId);
        }

        if (filters.departmentId !== undefined)
        {
            requireId(filters.departmentId);
        }

        if (filters.includeArchived)
        {
            if (adminId === undefined)
            {
                throw new ServiceError(403, "The admin role is required.");
            }

            await requireAccountRole(this.users, adminId, "admin");
        }

        return this.catalog.searchCourses(filters);
    }

    /**
     * Get a course only when its full hierarchy is active.
     * @param courseId Course to look up.
     * @returns Active course details.
     */
    getCourse(courseId: string)
    {
        requireId(courseId);
        return this.transaction(async connection =>
        {
            if (!await this.catalog.isCourseActive(courseId, connection))
            {
                throw new ServiceError(404, "Course not found.");
            }

            return this.catalog.findCourse(courseId, connection);
        });
    }

    /**
     * Create a catalog entry for an admin.
     * @param adminId Admin creating the entry.
     * @param entry College, department, or course details.
     * @returns ID of the new entry.
     */
    async createEntry(adminId: string, entry: CatalogEntry)
    {
        await requireAccountRole(this.users, adminId, "admin");

        return this.handleDuplicate(async () =>
        {
            switch (entry.kind)
            {
                case "college":
                    return this.catalog.createCollege(requireText(entry.name, 150, "College name"));
                case "department":
                    await this.requireActiveCollege(entry.collegeId);
                    return this.catalog.createDepartment(entry.collegeId, requireText(entry.name, 150, "Department name"));
                case "course":
                    return this.catalog.createCourse(await this.validateCourse(entry));
            }
        });
    }

    /**
     * Update a catalog entry while preserving its ID.
     * @param adminId Admin editing the entry.
     * @param id Catalog entry ID.
     * @param entry Replacement details, including the entry type.
     * @returns Whether a matching entry was updated.
     */
    async updateEntry(adminId: string, id: string, entry: CatalogEntry)
    {
        await requireAccountRole(this.users, adminId, "admin");
        requireId(id);

        return this.handleDuplicate(async () =>
        {
            switch (entry.kind)
            {
                case "college":
                    return this.catalog.updateCollege(id, requireText(entry.name, 150, "College name"));
                case "department":
                    await this.requireActiveCollege(entry.collegeId);
                    return this.catalog.updateDepartment(id, entry.collegeId, requireText(entry.name, 150, "Department name"));
                case "course":
                    return this.catalog.updateCourse(id, await this.validateCourse(entry));
            }
        });
    }

    /**
     * Archive an entry without removing booking references.
     * @param adminId Admin archiving the entry.
     * @param kind Type of catalog entry to archive.
     * @param id Catalog entry ID.
     * @returns Whether an active entry was archived.
     */
    async archiveEntry(adminId: string, kind: CatalogEntry["kind"], id: string)
    {
        await requireAccountRole(this.users, adminId, "admin");
        requireId(id);
        switch (kind)
        {
            case "college": return this.catalog.archiveCollege(id);
            case "department": return this.catalog.archiveDepartment(id);
            case "course": return this.catalog.archiveCourse(id);
        }
    }

    /**
     * Validate the import before writing all courses in one transaction.
     * @param adminId Admin importing the courses.
     * @param rows Course details in import order.
     * @returns IDs of the imported courses in input order.
     */
    async importCourses(adminId: string, rows: readonly CourseDetails[]): Promise<string[]>
    {
        await requireAccountRole(this.users, adminId, "admin");
        const courses: CourseDetails[] = [];
        const codes = new Set<string>();

        for (const [index, row] of rows.entries())
        {
            try
            {
                const course = await this.validateCourse(row);
                const code = `${course.subjectCode} ${course.courseNumber}`.toUpperCase();
                if (codes.has(code))
                {
                    throw new ServiceError(409, `Duplicate course code ${code}.`);
                }

                codes.add(code);
                courses.push(course);
            }
            catch (error)
            {
                if (error instanceof ServiceError)
                {
                    throw new ServiceError(error.status, `Row ${index + 1}: ${error.message}`);
                }

                throw error;
            }
        }

        return this.handleDuplicate(() => this.transaction(async connection =>
        {
            const ids: string[] = [];
            for (const course of courses)
            {
                ids.push(await this.catalog.createCourse(course, connection));
            }

            return ids;
        }));
    }

    /**
     * Check that the selected college is active.
     * @param id College whose status is checked.
     */
    private async requireActiveCollege(id: string): Promise<void>
    {
        const college = await this.catalog.findCollege(requireId(id));
        if (!college || college.archivedAt)
        {
            throw new ServiceError(404, "Active college not found.");
        }
    }

    /**
     * Normalize the course and check its parent records.
     * @param course Course details to validate.
     * @returns Normalized details for an active department.
     */
    private async validateCourse(course: CourseDetails): Promise<CourseDetails>
    {
        const department = await this.catalog.findDepartment(requireId(course.departmentId));
        if (!department || department.archivedAt)
        {
            throw new ServiceError(404, "Active department not found.");
        }

        await this.requireActiveCollege(department.collegeId);
        return {
            departmentId: department.id,
            subjectCode: requireText(course.subjectCode, 16, "Subject code").toUpperCase(),
            courseNumber: requireText(course.courseNumber, 16, "Course number"),
            title: requireText(course.title, 255, "Course title"),
        };
    }

    /**
     * Translate a database uniqueness violation into a conflict.
     * @typeParam T Result type of the catalog operation.
     * @param operation Catalog write that may violate a unique key.
     * @returns Result of the catalog write.
     */
    private async handleDuplicate<T>(operation: () => Promise<T>): Promise<T>
    {
        try
        {
            return await operation();
        }
        catch (error)
        {
            if ((error as NodeJS.ErrnoException)?.code === "ER_DUP_ENTRY")
            {
                throw new ServiceError(409, "A catalog entry with those details already exists.");
            }

            throw error;
        }
    }
}
