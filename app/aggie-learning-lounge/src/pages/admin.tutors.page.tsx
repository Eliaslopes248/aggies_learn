import { useCallback, useState, type FormEvent } from 'react'

import { courseLabel, jsonWrite, readJson, requestMessage, type Course, type Tutor } from '../api/catalog.js'
import type { ApiClient } from '../api/client.js'
import { readAssignedCourses } from '../api/tutor.assignments.js'
import { CoursePicker } from '../components/course.picker.js'
import { ConfirmationDialog } from '../components/ui/confirmation.dialog.js'
import { Button, Field } from '../components/ui/controls.js'
import { EmptyState, FormMessage, LoadingState } from '../components/ui/feedback.js'
import { useResource } from '../hooks/use.resource.js'

/**
 * Provision hired tutors and manage their course assignments.
 * @param props Shared API client.
 * @returns Admin tutor workspace.
 */
export default function AdminTutorsPage({ api }: { api: ApiClient }) : React.JSX.Element
{
    const [view, setView] = useState<'provision' | 'manage'>('provision')
    const [mode, setMode] = useState<'existing' | 'new'>('existing')
    const [picked, setPicked] = useState<Course[]>([])
    const [tutor, setTutor] = useState<Tutor | null>(null)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [message, setMessage] = useState('')

    const tutorId = tutor?.id
    const loadAssignments = useCallback((signal: AbortSignal) =>
        readAssignedCourses(api, `/tutors/${tutorId}/courses`, signal), [api, tutorId])
    const assignments = useResource(tutorId && view === 'manage' ? loadAssignments : null)

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
            <div className="record-actions">
                <Button
                    variant={view === 'provision' ? 'primary' : 'secondary'}
                    aria-pressed={view === 'provision'}
                    disabled={busy}
                    onClick={() =>
                    {
                        setView('provision')
                        setError('')
                        setMessage('')
                    }}
                >
                    Provision tutor
                </Button>
                <Button
                    variant={view === 'manage' ? 'primary' : 'secondary'}
                    aria-pressed={view === 'manage'}
                    disabled={busy}
                    onClick={() =>
                    {
                        setView('manage')
                        setError('')
                        setMessage('')
                    }}
                >
                    Manage assignments
                </Button>
            </div>

            {error && <FormMessage kind="error">{error}</FormMessage>}
            {message && <FormMessage kind="success">{message}</FormMessage>}

            {view === 'provision' ? (
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
            ) : (
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
                            <h2>{tutor.firstName} {tutor.lastName}</h2>
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
