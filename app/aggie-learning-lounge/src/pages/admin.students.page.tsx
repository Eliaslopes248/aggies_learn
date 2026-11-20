import { useEffect, useRef, useState, type FormEvent } from 'react'

import { jsonWrite, requestMessage } from '../api/catalog.js'
import type { ApiClient } from '../api/client.js'
import { AccountDirectory, type DirectoryProfile } from '../components/account.directory.js'
import { Button, Field } from '../components/ui/controls.js'
import { FormMessage } from '../components/ui/feedback.js'

/**
 * Browse student accounts and edit the selected student's name.
 * @param props Shared API client.
 * @returns Admin student catalog workspace.
 */
export default function AdminStudentsPage({ api }: { api: ApiClient }) : React.JSX.Element
{
    const [student, setStudent] = useState<DirectoryProfile | null>(null)
    const [revision, setRevision] = useState(0)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [message, setMessage] = useState('')
    const editorHeading = useRef<HTMLHeadingElement>(null)
    const catalogHeading = useRef<HTMLHeadingElement>(null)

    useEffect(() =>
    {
        if (student)
        {
            editorHeading.current?.focus()
        }
        else if (revision > 0)
        {
            catalogHeading.current?.focus()
        }
    }, [student, revision])

    /**
     * Save the selected student's name and refresh the catalog results.
     * @param event Student name form submission.
     */
    async function saveName(event: FormEvent<HTMLFormElement>) : Promise<void>
    {
        event.preventDefault()

        if (!student || busy)
        {
            return
        }

        const fields = new FormData(event.currentTarget)
        const firstName = String(fields.get('firstName')).trim()
        const lastName = String(fields.get('lastName')).trim()
        setError('')
        setBusy(true)

        try
        {
            await api.request(`/users/students/${student.id}`, jsonWrite('PATCH', { firstName, lastName }))
            setRevision(current => current + 1)
            setStudent(null)
            setMessage('Student name saved.')
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
            <h1 className="workspace-heading" ref={catalogHeading} tabIndex={-1}>Manage students</h1>
            <div className="record-actions" role="group" aria-label="Student management views">
                <Button
                    variant={student ? 'secondary' : 'primary'}
                    aria-pressed={!student}
                    disabled={busy}
                    onClick={() =>
                    {
                        setStudent(null)
                        setError('')
                    }}
                >
                    Student catalog
                </Button>
            </div>

            {message && <FormMessage kind="success">{message}</FormMessage>}
            <div hidden={Boolean(student)}>
                <AccountDirectory
                    api={api}
                    role="student"
                    active={!student}
                    revision={revision}
                    onEdit={selected =>
                    {
                        setMessage('')
                        setStudent(selected)
                    }}
                />
            </div>

            {student && (
                <form className="workspace-record workspace-form" aria-labelledby="edit-student-name" onSubmit={saveName}>
                    <h2 id="edit-student-name" ref={editorHeading} tabIndex={-1}>Edit {student.firstName} {student.lastName}</h2>
                    <div className="record-actions">
                        <Field
                            label="First name"
                            name="firstName"
                            maxLength={150}
                            defaultValue={student.firstName}
                            required
                            disabled={busy}
                        />
                        <Field
                            label="Last name"
                            name="lastName"
                            maxLength={150}
                            defaultValue={student.lastName}
                            required
                            disabled={busy}
                        />
                    </div>
                    {error && <FormMessage kind="error">{error}</FormMessage>}
                    <div className="record-actions">
                        <Button type="submit" pending={busy}>Save student name</Button>
                    </div>
                </form>
            )}
        </section>
    )
}
