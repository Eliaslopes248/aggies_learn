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

import { useCallback } from 'react'
import { Link } from 'react-router'

import type { ApiClient } from '../api/client.js'
import { readAssignedCourses } from '../api/tutor.assignments.js'
import { EmptyState, FormMessage, LoadingState } from '../components/ui/feedback.js'
import { useResource } from '../hooks/use.resource.js'

/**
 * Render active course assignments for the signed-in tutor.
 * @param props Shared API client.
 * @returns Tutor course workspace.
 */
export default function TutorCoursesPage({ api }: { api: ApiClient }) : React.JSX.Element
{
    const courses = useResource(useCallback((signal: AbortSignal) =>
        readAssignedCourses(api, '/tutors/me/courses', signal), [api]))

    return (
        <section className="catalog-section page-width">
            <h1 className="workspace-heading">My assigned courses</h1>
            <Link className="text-link" to="/tutor/calendar">Tutor calendar</Link>

            {courses.pending && <LoadingState label="Loading assigned courses" />}
            {courses.error && <FormMessage kind="error">{courses.error}</FormMessage>}
            {courses.data?.length === 0 && (
                <EmptyState title="No assigned courses">
                    Contact your program admin to request a course assignment.
                </EmptyState>
            )}
            <ul className="record-list">
                {courses.data?.map(course => (
                    <li className="workspace-record" key={course.courseId}>{course.label}</li>
                ))}
            </ul>
        </section>
    )
}
