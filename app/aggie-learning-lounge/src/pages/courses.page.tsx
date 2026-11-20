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

import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router'

import { authLink } from '../api/auth.navigation.js'
import { courseLabel, readJson, type College, type Course, type Department, type Tutor } from '../api/catalog.js'
import type { ApiClient, Profile } from '../api/client.js'
import { Button, Field } from '../components/ui/controls.js'
import { EmptyState, FormMessage, LoadingState } from '../components/ui/feedback.js'
import { useResource } from '../hooks/use.resource.js'

const pageSize = 25
const CourseSlots = lazy(() => import('../components/course.slots.js'))

/**
 * Render the public course catalog with shareable filters.
 * @param props Shared API client.
 * @returns Course discovery page.
 */
export function CoursesPage({ api }: { api: ApiClient }) : React.JSX.Element
{
    const [params, setParams] = useSearchParams()
    const search = params.get('search') ?? ''
    const collegeId = params.get('collegeId') ?? ''
    const departmentId = params.get('departmentId') ?? ''
    const rawOffset = params.get('offset') ?? '0'
    const offset = /^\d{1,8}$/.test(rawOffset) ? Number(rawOffset) : 0
    const [draft, setDraft] = useState({ source: search, text: search })
    const searchInput = draft.source === search ? draft.text : search

    // Debounce typing while keeping the confirmed filters in the URL.
    useEffect(() =>
    {
        if (searchInput.trim() === search)
        {
            return
        }

        const timer = setTimeout(() =>
        {
            setParams(current =>
            {
                const next = new URLSearchParams(current)

                if (searchInput.trim())
                {
                    next.set('search', searchInput.trim())
                }
                else
                {
                    next.delete('search')
                }

                next.delete('offset')
                return next
            }, { replace: true })
        }, 300)

        return () => clearTimeout(timer)
    }, [search, searchInput, setParams])

    const colleges = useResource(useCallback((signal: AbortSignal) =>
        readJson<College[]>(api, '/catalog/colleges', { signal }), [api]))
    const loadDepartments = useCallback((signal: AbortSignal) =>
        readJson<Department[]>(api, `/catalog/colleges/${encodeURIComponent(collegeId)}/departments`, { signal }), [api, collegeId])
    const departments = useResource(collegeId ? loadDepartments : null)
    const courses = useResource(useCallback((signal: AbortSignal) =>
    {
        const query = new URLSearchParams({ limit: String(pageSize), offset: String(offset) })

        for (const [key, value] of Object.entries({ search, collegeId, departmentId }))
        {
            if (value)
            {
                query.set(key, value)
            }
        }

        return readJson<Course[]>(api, `/catalog/courses?${query}`, { signal })
    }, [api, collegeId, departmentId, offset, search]))

    /**
     * Update a filter and reset the results page when applicable.
     * @param key Query field to update.
     * @param value New field value.
     */
    function changeFilter(key: string, value: string) : void
    {
        const next = new URLSearchParams(params)

        if (value)
        {
            next.set(key, value)
        }
        else
        {
            next.delete(key)
        }

        if (key === 'collegeId')
        {
            next.delete('departmentId')
        }

        if (key !== 'offset')
        {
            next.delete('offset')
        }

        setParams(next)
    }

    return (
        <div className="courses-page">
            <section className="courses-hero" aria-labelledby="courses-heading">
                <div className="hero-content page-width">
                    <p className="hero-campus">NORTH CAROLINA A&amp;T STATE UNIVERSITY</p>
                    <h1 id="courses-heading">
                        Find tutoring for<br className="hero-break" /> your course.
                    </h1>
                    <div className="catalog-search">
                        <Field
                            label="Search courses"
                            type="search"
                            value={searchInput}
                            placeholder="Course code or title"
                            onChange={event => setDraft({ source: search, text: event.target.value })}
                        />
                    </div>
                </div>
            </section>

            <section className="catalog-section page-width" aria-labelledby="catalog-heading">
                <div className="catalog-toolbar">
                    <h2 id="catalog-heading">Course catalog</h2>
                    <details className="catalog-filters">
                        <summary>Filters{collegeId || departmentId ? ' (active)' : ''}</summary>
                        <div className="filter-fields">
                            <label className="field">College
                                <select
                                    value={collegeId}
                                    onChange={event => changeFilter('collegeId', event.target.value)}
                                >
                                    <option value="">All colleges</option>
                                    {colleges.data?.map(college => (
                                        <option key={college.id} value={college.id}>
                                            {college.name}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            {collegeId && (
                                <label className="field">Department
                                    <select
                                        value={departmentId}
                                        onChange={event => changeFilter('departmentId', event.target.value)}
                                    >
                                        <option value="">All departments</option>
                                        {departments.data?.map(department => (
                                            <option key={department.id} value={department.id}>
                                                {department.name}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            )}
                            {(colleges.error || departments.error) && (
                                <FormMessage kind="error">Some filters could not be loaded.</FormMessage>
                            )}
                        </div>
                    </details>
                </div>

                {courses.pending && <LoadingState label="Loading courses" />}
                {courses.error && <RequestError message={courses.error} retry={courses.reload} />}
                {courses.data?.length === 0 && (
                    <EmptyState
                        title="No courses found"
                        action={
                            (search || collegeId || departmentId) && (
                                <Button
                                    onClick={() =>
                                    {
                                        setDraft({ source: '', text: '' })
                                        setParams({})
                                    }}
                                >
                                    Clear filters
                                </Button>
                            )
                        }
                    >
                        {search || collegeId || departmentId
                            ? 'Try changing your search or filters.'
                            : 'Course listings will appear here as they are added.'}
                    </EmptyState>
                )}
                {Boolean(courses.data?.length) && (
                    <ul className="record-list">
                        {courses.data?.map(course => (
                            <li key={course.id}>
                                <Link
                                    className="course-card"
                                    to={`/courses/${course.id}${params.size ? `?${params}` : ''}`}
                                >
                                    <span className="section-label">
                                        {course.subjectCode} {course.courseNumber}
                                    </span>
                                    <strong>{course.title}</strong>
                                    <span className="course-card-arrow" aria-hidden="true">→</span>
                                </Link>
                            </li>
                        ))}
                    </ul>
                )}
                {courses.data && (offset > 0 || courses.data.length === pageSize) && (
                    <div className="record-actions">
                        <Button
                            variant="secondary"
                            disabled={offset === 0}
                            onClick={() => changeFilter('offset', String(Math.max(0, offset - pageSize)))}
                        >
                            Previous page
                        </Button>
                        <Button
                            variant="secondary"
                            disabled={courses.data.length < pageSize}
                            onClick={() => changeFilter('offset', String(offset + pageSize))}
                        >
                            Next page
                        </Button>
                    </div>
                )}
            </section>
        </div>
    )
}

/**
 * Render course details and the signed-in tutor roster.
 * @param props API client and current session state.
 * @returns Course detail page.
 */
export function CourseDetailPage({ api, signedIn, sessionLoading, profile }: {
    api: ApiClient; signedIn: boolean; sessionLoading: boolean; profile: Profile | null
}) : React.JSX.Element
{
    const { courseId } = useParams()
    const { pathname, search } = useLocation()
    const coursePath = encodeURIComponent(courseId ?? '')
    const course = useResource(useCallback((signal: AbortSignal) =>
        readJson<Course>(api, `/catalog/courses/${coursePath}`, { signal }), [api, coursePath]))
    const loadTutors = useCallback((signal: AbortSignal) =>
        readJson<Tutor[]>(api, `/tutors?courseId=${coursePath}`, { signal, authenticated: true }), [api, coursePath])
    const tutors = useResource(signedIn && course.data ? loadTutors : null)

    return (
        <section className="catalog-section page-width">
            <Link className="text-link" to={`/courses${search}`}>Back to courses</Link>
            {course.pending && <LoadingState label="Loading course" />}
            {course.error && <RequestError message={course.error} retry={course.reload} />}

            {course.data && (
                <>
                    <h1 className="workspace-heading">{courseLabel(course.data)}</h1>
                    {sessionLoading && <LoadingState label="Restoring session" />}
                    {!sessionLoading && !signedIn && (
                        <EmptyState
                            title="Sign in to find tutors"
                            action={
                                <Link className="button button--primary" to={authLink('/sign-in', pathname + search)}>
                                    Sign in
                                </Link>
                            }
                        >
                            Sign in to see tutors assigned to this course.
                        </EmptyState>
                    )}
                    {tutors.pending && <LoadingState label="Loading tutors" />}
                    {tutors.error && <RequestError message={tutors.error} retry={tutors.reload} />}
                    {tutors.data?.length === 0 && (
                        <EmptyState title="No tutors available">
                            No tutors are assigned to this course yet.
                        </EmptyState>
                    )}
                    {Boolean(tutors.data?.length) && (
                        <section aria-labelledby="course-tutors">
                            <h2 id="course-tutors">Tutors for this course</h2>
                            <ul className="record-list">
                                {tutors.data?.map(tutor => (
                                    <li className="workspace-record" key={tutor.id}>
                                        {tutor.firstName} {tutor.lastName}
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}
                    {tutors.data && tutors.data.length > 0 && (
                        <Suspense fallback={<LoadingState label="Loading available times" />}>
                            <CourseSlots
                                key={coursePath}
                                api={api}
                                courseId={coursePath}
                                title={courseLabel(course.data)}
                                tutors={tutors.data}
                                profile={profile}
                                returnTo={pathname + search}
                            />
                        </Suspense>
                    )}
                </>
            )}
        </section>
    )
}

/**
 * Show a failed resource request with a retry action.
 * @param props Error text and retry callback.
 * @returns Inline error and action.
 */
function RequestError({ message, retry }: { message: string; retry: () => void }) : React.JSX.Element
{
    return (
        <div className="workspace-record">
            <FormMessage kind="error">{message}</FormMessage>
            <Button variant="secondary" onClick={retry}>Try again</Button>
        </div>
    )
}
