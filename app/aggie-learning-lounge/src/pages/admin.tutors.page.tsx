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

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'

import { courseLabel, jsonWrite, readJson, requestMessage, type Course, type Tutor } from '../api/catalog.js'
import type { ApiClient } from '../api/client.js'
import { readAssignedCourses } from '../api/tutor.assignments.js'
import { CoursePicker } from '../components/course.picker.js'
import { AccountDirectory } from '../components/account.directory.js'
import { ConfirmationDialog } from '../components/ui/confirmation.dialog.js'
import { Button, Field } from '../components/ui/controls.js'
import { EmptyState, FormMessage, LoadingState } from '../components/ui/feedback.js'
import { useResource } from '../hooks/use.resource.js'

type View = 'provision' | 'directory' | 'manage'

/**
 * Provision hired tutors, browse the directory, and manage assignments.
 * @param props Shared API client.
 * @returns Admin tutor workspace.
 */
export default function AdminTutorsPage({ api }: { api: ApiClient }) : React.JSX.Element
{
    const [view, setView] = useState<View>('provision')
    const [mode, setMode] = useState<'existing' | 'new'>('existing')
    const [picked, setPicked] = useState<Course[]>([])
    const [tutor, setTutor] = useState<Tutor | null>(null)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [message, setMessage] = useState('')
    const tutorHeading = useRef<HTMLHeadingElement>(null)

    const tutorId = tutor?.id
    const loadAssignments = useCallback((signal: AbortSignal) =>
        readAssignedCourses(api, `/tutors/${tutorId}/courses`, signal), [api, tutorId])
    const assignments = useResource(tutorId && view === 'manage' ? loadAssignments : null)

    useEffect(() =>
    {
        if (view === 'manage' && tutorId)
        {
            tutorHeading.current?.focus()
        }
    }, [view, tutorId])

    /**
     * Open a workspace view and clear feedback from the previous view.
     * @param next View to open.
     */
    function changeView(next: View) : void
    {
        setView(next)
        setError('')
        setMessage('')
    }

    /**
     * Open the selected tutor in the editor.
     * @param selected Tutor chosen in the directory.
     */
    function editTutor(selected: Tutor) : void
    {
        setTutor(selected)
        changeView('manage')
    }

    /**
     * Create or reuse a tutor account with the reviewed course list.
     * @param event Tutor provisioning form submission.
     */
    async function provision(event: FormEvent<HTMLFormElement>) : Promise<void>
    {
        event.preventDefault()
        const details = Object.fromEntries(new FormData(event.currentTarget))
        setBusy(true)
        setError('')
        setMessage('')

        try
        {
            const created = await readJson<Tutor>(api, '/tutors', jsonWrite('POST', {
                ...details, courseIds: picked.map(course => course.id),
            }))
            setTutor(created)
            setPicked([])
            setMessage('Tutor access saved.')
            setView('manage')
        }
        catch (error)
        {
            setError(requestMessage(error))
        }
        finally
        {
            setBusy(false)
        }
    }

    /**
     * Find an already provisioned tutor by account ID.
     * @param event Submitted tutor lookup form.
     */
    async function findTutor(event: FormEvent<HTMLFormElement>) : Promise<void>
    {
        event.preventDefault()
        const id = String(new FormData(event.currentTarget).get('accountId')).trim()
        setBusy(true)
        setTutor(null)
        setMessage('')
        setError('')

        try
        {
            const account = await readJson<Tutor & { roles: string[] }>(api, `/users/${encodeURIComponent(id)}`, { authenticated: true })

            if (!account.roles.includes('tutor'))
            {
                setError('That account does not have tutor access. Use Provision tutor to grant access.')
                return
            }

            setTutor(account)
        }
        catch (error)
        {
            setError(requestMessage(error))
        }
        finally
        {
            setBusy(false)
        }
    }

    /**
     * Save the selected tutor's first and last name.
     * @param event Tutor name form submission.
     */
    async function saveTutorName(event: FormEvent<HTMLFormElement>) : Promise<void>
    {
        event.preventDefault()
        if (!tutor)
        {
            return
        }

        const fields = new FormData(event.currentTarget)
        const names = {
            firstName: String(fields.get('firstName')).trim(),
            lastName: String(fields.get('lastName')).trim(),
        }
        setBusy(true)
        setError('')
        setMessage('')

        try
        {
            await api.request(`/tutors/${tutor.id}`, jsonWrite('PATCH', names))
            setTutor({ ...tutor, ...names })
            setMessage('Tutor name saved.')
        }
        catch (error)
        {
            setError(requestMessage(error))
        }
        finally
        {
            setBusy(false)
        }
    }

    /**
     * Add or deactivate a course for the selected tutor.
     * @param courseId ID of the course.
     * @param method Assignment operation.
     */
    async function changeAssignment(courseId: string, method: 'PUT' | 'DELETE') : Promise<void>
    {
        setBusy(true)
        setError('')
        setMessage('')

        try
        {
            await api.request(`/tutors/${tutorId}/courses/${courseId}`, { method, authenticated: true })
            setMessage(method === 'PUT' ? 'Course assigned.' : 'Course assignment deactivated.')
            assignments.reload()
        }
        catch (error)
        {
            setError(requestMessage(error))
        }
        finally
        {
            setBusy(false)
        }
    }

    return (
        <section className="catalog-section page-width">
            <h1 className="workspace-heading">Manage tutors</h1>
            <div className="record-actions" role="group" aria-label="Tutor management views">
                <Button
                    variant={view === 'provision' ? 'primary' : 'secondary'}
                    aria-pressed={view === 'provision'}
                    disabled={busy}
                    onClick={() => changeView('provision')}
                >
                    Provision tutor
                </Button>
                <Button
                    variant={view === 'directory' ? 'primary' : 'secondary'}
                    aria-pressed={view === 'directory'}
                    disabled={busy}
                    onClick={() => changeView('directory')}
                >
                    Tutor directory
                </Button>
                <Button
                    variant={view === 'manage' ? 'primary' : 'secondary'}
                    aria-pressed={view === 'manage'}
                    disabled={busy}
                    onClick={() => changeView('manage')}
                >
                    Manage assignments
                </Button>
            </div>

            {error && <FormMessage kind="error">{error}</FormMessage>}
            {message && <FormMessage kind="success">{message}</FormMessage>}

            <div hidden={view !== 'directory'}>
                <AccountDirectory role="tutor" api={api} active={view === 'directory'} onEdit={editTutor} />
            </div>

            {view === 'provision' && (
                <div className="workspace-record workspace-form">
                    <label className="field">Account setup
                        <select
                            value={mode}
                            disabled={busy}
                            onChange={event => setMode(event.target.value === 'new' ? 'new' : 'existing')}
                        >
                            <option value="existing">Use an existing account</option>
                            <option value="new">Create a new account</option>
                        </select>
                    </label>

                    <form id="provision-tutor" className="workspace-form" onSubmit={provision}>
                        {mode === 'existing' ? (
                            <Field
                                name="accountId"
                                label="Existing account ID"
                                pattern="[1-9][0-9]*"
                                inputMode="numeric"
                                required
                            />
                        ) : (
                            <>
                                <Field
                                    label="First name"
                                    name="firstName"
                                    autoComplete="given-name"
                                    required
                                    maxLength={150}
                                />
                                <Field
                                    label="Last name"
                                    name="lastName"
                                    autoComplete="family-name"
                                    required
                                    maxLength={150}
                                />
                                <Field
                                    label="Email"
                                    name="email"
                                    type="email"
                                    autoComplete="username"
                                    required
                                    maxLength={254}
                                />
                                <Field
                                    label="Initial password"
                                    name="password"
                                    type="password"
                                    autoComplete="new-password"
                                    required
                                    minLength={12}
                                />
                            </>
                        )}
                    </form>

                    <CoursePicker
                        api={api}
                        selected={picked.map(course => course.id)}
                        disabled={busy}
                        onSelect={course => setPicked(current => [...current, course])}
                    />

                    <section aria-labelledby="selected-courses">
                        <h2 id="selected-courses">Selected courses</h2>
                        {picked.length === 0 && <p>No courses selected.</p>}
                        <ul className="picker-results">
                            {picked.map(course => (
                                <li className="picker-result" key={course.id}>
                                    {courseLabel(course)}
                                    <Button
                                        variant="quiet"
                                        disabled={busy}
                                        aria-label={`Remove ${courseLabel(course)}`}
                                        onClick={() => setPicked(current => current.filter(item => item.id !== course.id))}
                                    >
                                        Remove
                                    </Button>
                                </li>
                            ))}
                        </ul>
                    </section>

                    <Button type="submit" form="provision-tutor" pending={busy}>
                        Save tutor access
                    </Button>
                </div>
            )}

            {view === 'manage' && (
                <div className="workspace-record workspace-form">
                    <form className="record-actions" onSubmit={findTutor}>
                        <Field
                            name="accountId"
                            label="Tutor account ID"
                            pattern="[1-9][0-9]*"
                            inputMode="numeric"
                            required
                        />
                        <Button type="submit" pending={busy}>Find tutor</Button>
                    </form>

                    {tutor && (
                        <section className="workspace-form" aria-label="Tutor assignments">
                            <h2 ref={tutorHeading} tabIndex={-1}>{tutor.firstName} {tutor.lastName}</h2>

                            <form
                                key={tutor.id}
                                className="workspace-form"
                                aria-label="Edit tutor name"
                                onSubmit={saveTutorName}
                            >
                                <div className="record-actions">
                                    <Field
                                        label="First name"
                                        name="firstName"
                                        maxLength={150}
                                        defaultValue={tutor.firstName}
                                        required
                                        disabled={busy}
                                    />
                                    <Field
                                        label="Last name"
                                        name="lastName"
                                        maxLength={150}
                                        defaultValue={tutor.lastName}
                                        required
                                        disabled={busy}
                                    />
                                </div>
                                <div className="record-actions">
                                    <Button type="submit" variant="secondary" pending={busy}>Save tutor name</Button>
                                </div>
                            </form>

                            <h3>Active course assignments</h3>
                            {assignments.pending && <LoadingState label="Loading assignments" />}
                            {assignments.error && (
                                <FormMessage kind="error">{assignments.error}</FormMessage>
                            )}
                            {assignments.data?.length === 0 && (
                                <EmptyState title="No active assignments">
                                    Choose a course to assign it to this tutor.
                                </EmptyState>
                            )}
                            <ul className="picker-results">
                                {assignments.data?.map(assignment => (
                                    <li className="picker-result" key={assignment.courseId}>
                                        <span>{assignment.label}</span>
                                        {!busy && (
                                            <ConfirmationDialog
                                                triggerLabel="Deactivate"
                                                title="Deactivate this assignment?"
                                                description="New bookings for this course will stop. Existing bookings are preserved."
                                                confirmLabel="Deactivate assignment"
                                                destructive
                                                onConfirm={() => void changeAssignment(assignment.courseId, 'DELETE')}
                                            />
                                        )}
                                    </li>
                                ))}
                            </ul>

                            <CoursePicker
                                api={api}
                                selected={assignments.data?.map(item => item.courseId) ?? []}
                                disabled={busy || !assignments.data}
                                onSelect={course => void changeAssignment(course.id, 'PUT')}
                            />
                        </section>
                    )}
                </div>
            )}
        </section>
    )
}
