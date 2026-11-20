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

import { useEffect, useRef, useState, type FormEvent } from 'react'

import { jsonWrite, requestMessage } from '../api/catalog.js'
import type { ApiClient } from '../api/client.js'
import { AccountDirectory, type DirectoryProfile } from '../components/account.directory.js'
import { ConfirmationDialog } from '../components/ui/confirmation.dialog.js'
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
    const [passwordRevision, setPasswordRevision] = useState(0)
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
        setMessage('')
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

    /**
     * Set a new password or request delivery of a generated password.
     * @param password Password supplied by the admin, if setting it directly.
     */
    async function changePassword(password?: string) : Promise<void>
    {
        if (!student || busy)
        {
            return
        }

        setBusy(true)
        setError('')
        setMessage('')

        try
        {
            const path = `/users/students/${student.id}/password`
            if (password === undefined)
            {
                await api.request(`${path}/reset`, { method: 'POST', authenticated: true })
                setMessage('Reset password emailed to the student.')
            }
            else
            {
                await api.request(path, jsonWrite('PUT', { password }))
                setMessage('Student password updated.')
            }
            setPasswordRevision(current => current + 1)
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
     * Read the new password from the manual password form.
     * @param event Password form submission.
     */
    function savePassword(event: FormEvent<HTMLFormElement>) : void
    {
        event.preventDefault()
        const fields = new FormData(event.currentTarget)
        void changePassword(String(fields.get('password')))
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
                <section className="workspace-form" aria-labelledby="edit-student">
                    <h2 id="edit-student" ref={editorHeading} tabIndex={-1}>Edit {student.firstName} {student.lastName}</h2>
                    {error && <FormMessage kind="error">{error}</FormMessage>}
                    <form className="workspace-record workspace-form" aria-label="Edit student name" onSubmit={saveName}>
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
                        <div className="record-actions">
                            <Button type="submit" pending={busy}>Save student name</Button>
                        </div>
                    </form>
                    <section className="workspace-record workspace-form" aria-labelledby="student-password-heading">
                        <h3 id="student-password-heading">Password</h3>
                        <form key={passwordRevision} className="workspace-form" onSubmit={savePassword}>
                            <Field
                                label="New student password"
                                name="password"
                                type="password"
                                autoComplete="new-password"
                                minLength={12}
                                required
                                disabled={busy}
                            />
                            <div className="record-actions">
                                <Button type="submit" pending={busy}>Set password</Button>
                            </div>
                        </form>
                        {student.emailVerifiedAt
                            ? !busy && (
                                <div className="record-actions">
                                    <ConfirmationDialog
                                        triggerLabel="Email a reset password"
                                        title="Reset this student's password?"
                                        description={`A generated password will replace the current password and be sent to ${student.email}.`}
                                        confirmLabel="Reset and email password"
                                        onConfirm={() => void changePassword()}
                                    />
                                </div>
                            )
                            : <p>The student must verify their email before an emailed reset.</p>}
                    </section>
                </section>
            )}
        </section>
    )
}
