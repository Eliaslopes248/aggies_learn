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
import { type College, type Course, type Department } from "../../models/academic.model.js";

// Options for browsing courses
export interface CourseSearch
{
    collegeId?: string;
    departmentId?: string;
    search?: string;
    includeArchived?: boolean;
    limit: number;
    offset: number;
}

export type CourseDetails = Pick<Course, "departmentId" | "subjectCode" | "courseNumber" | "title">;

export interface ICatalogRepository
{
    /** Find a college by ID. */
    findCollege(id: string): Promise<College | null>;

    /** Find a department by ID. */
    findDepartment(id: string): Promise<Department | null>;

    /** Find a course by ID, including archived courses. */
    findCourse(id: string, connection?: PoolConnection): Promise<Course | null>;

    /** Check that a course and its parents are active inside a transaction. */
    isCourseActive(id: string, connection: PoolConnection): Promise<boolean>;

    /** List colleges for the catalog. */
    listColleges(includeArchived?: boolean): Promise<College[]>;

    /** List departments for a college. */
    listDepartments(collegeId: string, includeArchived?: boolean): Promise<Department[]>;

    /** Search courses with stable pagination. */
    searchCourses(filters: CourseSearch): Promise<Course[]>;

    /** Create a college and return its ID. */
    createCollege(name: string): Promise<string>;

    /** Create a department and return its ID. */
    createDepartment(collegeId: string, name: string): Promise<string>;

    /** Create a course and return its ID. */
    createCourse(course: CourseDetails, connection?: PoolConnection): Promise<string>;

    /** Update a college name. */
    updateCollege(id: string, name: string): Promise<boolean>;

    /** Update a department name and college. */
    updateDepartment(id: string, collegeId: string, name: string): Promise<boolean>;

    /** Update course details. */
    updateCourse(id: string, course: CourseDetails): Promise<boolean>;

    /** Archive a college. */
    archiveCollege(id: string): Promise<boolean>;

    /** Archive a department. */
    archiveDepartment(id: string): Promise<boolean>;

    /** Archive a course. */
    archiveCourse(id: string): Promise<boolean>;
}
