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
