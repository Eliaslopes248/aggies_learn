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

import { type ICatalogRepository } from "../database/repositories/interfaces/catalog.interface.js";
import { type ITutorAssignmentRepository } from "../database/repositories/interfaces/tutor-assignments.interface.js";
import { type IUserRepository } from "../database/repositories/interfaces/users.interface.js";
import { type RunTransaction } from "../database/transaction.js";
import { hashPassword } from "./password.utils.js";
import { requireAccountRole, requireId, requireText, ServiceError } from "./service.utils.js";
import { toUserProfile } from "./users.service.js";

type TutorProvisioning = { courseIds: readonly string[] } & (
    { accountId: string } |
    { email: string; firstName: string; lastName: string; password: string }
);

export class TutoringService
{
    /**
     * Create the tutoring service with account and assignment dependencies.
     * @param users Repository used to find accounts and grant tutor roles.
     * @param catalog Repository used to check course eligibility.
     * @param assignments Repository used to manage course assignments.
     * @param transaction Runner used to save account and assignment changes together.
     */
    constructor(
        private readonly users: IUserRepository,
        private readonly catalog: ICatalogRepository,
        private readonly assignments: ITutorAssignmentRepository,
        private readonly transaction: RunTransaction,
    ) {}

    /**
     * Grant tutor access and assign courses together.
     * @param adminId Admin granting tutor access.
     * @param input Existing account ID or new account details, plus course IDs.
     * @returns Tutor profile with credential fields omitted.
     */
    async provisionTutor(adminId: string, input: TutorProvisioning)
    {
        await requireAccountRole(this.users, adminId, "admin");
        const courseIds = [...new Set(input.courseIds.map(requireId))].sort();

        const details = "accountId" in input ? null : {
            email: requireText(input.email, 254, "Email").toLowerCase(),
            firstName: requireText(input.firstName, 150, "First name"),
            lastName: requireText(input.lastName, 150, "Last name"),
            passwordHash: await hashPassword(input.password),
        };
        if (details && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.email))
        {
            throw new ServiceError(400, "Invalid email address.");
        }

        return this.transaction(async connection =>
        {
            const existing = "accountId" in input
                ? await this.users.findAccountById(requireId(input.accountId), connection)
                : await this.users.findAccountByEmail(details!.email, connection);
            if (!existing && !details)
            {
                throw new ServiceError(404, "Account not found.");
            }

            const account = existing ?? await this.users.createAccount(details!, ["tutor"], connection);
            if (existing)
            {
                await this.users.assignRole(account.id, "tutor", connection);
            }

            for (const courseId of courseIds)
            {
                await this.saveAssignment(adminId, account.id, courseId, connection);
            }

            return toUserProfile(account);
        });
    }

    /**
     * Assign an existing tutor to an active course.
     * @param adminId Admin authorizing the assignment.
     * @param tutorId Tutor receiving the assignment.
     * @param courseId Active course to assign.
     */
    async assignCourse(adminId: string, tutorId: string, courseId: string): Promise<void>
    {
        await requireAccountRole(this.users, adminId, "admin");
        await requireAccountRole(this.users, tutorId, "tutor");
        await this.transaction(connection => this.saveAssignment(adminId, tutorId, requireId(courseId), connection));
    }

    /**
     * Deactivate an assignment while preserving existing bookings.
     * @param adminId Admin deactivating the assignment.
     * @param tutorId Tutor whose assignment is being removed.
     * @param courseId Course to remove from the tutor’s active assignments.
     * @returns Whether the assignment was deactivated.
     */
    async deactivateCourse(adminId: string, tutorId: string, courseId: string): Promise<boolean>
    {
        await requireAccountRole(this.users, adminId, "admin");
        return this.assignments.deactivate(requireId(tutorId), requireId(courseId));
    }

    /**
     * List active tutor assignments for a tutor calendar.
     * @param tutorId Tutor whose assignments are requested.
     * @returns The tutor’s active assignments.
     */
    listTutorCourses(tutorId: string)
    {
        return this.assignments.listByTutor(requireId(tutorId));
    }

    /**
     * List active assignments for an active course.
     * @param courseId Active course whose tutors are requested.
     * @returns Active assignments for the course.
     */
    listCourseTutors(courseId: string)
    {
        requireId(courseId);
        return this.transaction(async connection =>
        {
            if (!await this.catalog.isCourseActive(courseId, connection))
            {
                throw new ServiceError(404, "Course not found.");
            }

            return this.assignments.listByCourse(courseId, false, connection);
        });
    }

    /**
     * Check and lock the catalog before assigning a course.
     * @param adminId Admin authorizing the assignment.
     * @param tutorId Tutor receiving the assignment.
     * @param courseId Course to validate and assign.
     * @param connection Connection used for the catalog lock and assignment write.
     */
    private async saveAssignment(adminId: string, tutorId: string, courseId: string, connection: PoolConnection): Promise<void>
    {
        if (!await this.catalog.isCourseActive(courseId, connection))
        {
            throw new ServiceError(404, "Course not found.");
        }

        await this.assignments.assign(tutorId, courseId, adminId, connection);
    }
}
