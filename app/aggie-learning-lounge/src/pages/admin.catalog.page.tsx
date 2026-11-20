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

import { useCallback, useState, type FormEvent } from 'react'

import { courseLabel, jsonWrite, readJson, requestMessage, type College, type Course, type CourseInput, type Department } from '../api/catalog.js'
import type { ApiClient } from '../api/client.js'
import { ConfirmationDialog } from '../components/ui/confirmation.dialog.js'
import { Button, Field } from '../components/ui/controls.js'
import { EmptyState, FormMessage, LoadingState, StatusLabel } from '../components/ui/feedback.js'
import { useResource } from '../hooks/use.resource.js'

type Collection = 'colleges' | 'departments' | 'courses'
type Entry = College | Department | Course
const collections: Record<Collection, string> = { colleges: 'Colleges', departments: 'Departments', courses: 'Courses' }

/**
 * Manage academic catalog entries and import courses.
 * @param props Shared API client.
 * @returns Admin catalog workspace.
 */
export default function AdminCatalogPage({ api }: { api: ApiClient }) : React.JSX.Element
{
    const [collection, setCollection] = useState<Collection>('colleges')
    const [includeArchived, setIncludeArchived] = useState(false)
    const [selectedCollege, setSelectedCollege] = useState('')
    const [offset, setOffset] = useState(0)
    const [searchInput, setSearchInput] = useState('')
    const [search, setSearch] = useState('')
    const [editing, setEditing] = useState<Entry | null | undefined>()
    const [busy, setBusy] = useState(false)
    const [message, setMessage] = useState('')
    const [error, setError] = useState('')

    const archiveQuery = includeArchived ? '?includeArchived=true' : ''
    const colleges = useResource(useCallback((signal: AbortSignal) =>
        readJson<College[]>(api, `/catalog/colleges${archiveQuery}`, { signal, authenticated: includeArchived }),
    [api, archiveQuery, includeArchived]))
    const collegeId = selectedCollege || colleges.data?.[0]?.id || ''
    const loadDepartments = useCallback((signal: AbortSignal) =>
        readJson<Department[]>(api, `/catalog/colleges/${collegeId}/departments${archiveQuery}`, {
            signal, authenticated: includeArchived,
        }), [api, archiveQuery, collegeId, includeArchived])
    const departments = useResource(collegeId && collection !== 'colleges' ? loadDepartments : null)
    const loadCourses = useCallback((signal: AbortSignal) =>
        readJson<Course[]>(api, `/catalog/courses?${new URLSearchParams({
            collegeId, search, offset: String(offset), limit: '25', includeArchived: String(includeArchived),
        })}`, { signal, authenticated: includeArchived }), [api, collegeId, includeArchived, offset, search])
    const courses = useResource(collegeId && collection === 'courses' ? loadCourses : null)

    const records = collection === 'colleges' ? colleges : collection === 'departments' ? departments : courses
    const visibleRecords = collection === 'courses'
        ? courses.data
        : (collection === 'colleges' ? colleges.data : departments.data)
            ?.filter(entry => entry.name.toLowerCase().includes(search.toLowerCase()))
    const activeColleges = colleges.data?.filter(college => !college.archivedAt) ?? []
    const activeDepartments = departments.data?.filter(department => !department.archivedAt) ?? []

    /**
     * Save the fields for the selected catalog collection.
     * @param event Submitted entry form.
     */
    async function save(event: FormEvent<HTMLFormElement>) : Promise<void>
    {
        event.preventDefault()
        const fields = Object.fromEntries(new FormData(event.currentTarget))
        setBusy(true)
        setError('')
        setMessage('')

        try
        {
            const path = `/catalog/${collection}${editing ? `/${editing.id}` : ''}`
            await api.request(path, jsonWrite(editing ? 'PATCH' : 'POST', fields))
            setEditing(undefined)
            setMessage('Catalog entry saved.')
            records.reload()
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
     * Archive an entry after confirmation.
     * @param entry Entry confirmed by the admin.
     */
    async function archive(entry: Entry) : Promise<void>
    {
        setBusy(true)
        setMessage('')
        setError('')

        try
        {
            await api.request(`/catalog/${collection}/${entry.id}`, { method: 'DELETE', authenticated: true })
            setEditing(undefined)
            setMessage('Catalog entry archived.')
            records.reload()
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
            <h1 className="workspace-heading">Manage catalog</h1>

            <div className="record-actions">
                {(Object.keys(collections) as Collection[]).map(key => (
                    <Button
                        key={key}
                        variant={key === collection ? 'primary' : 'secondary'}
                        aria-pressed={key === collection}
                        disabled={busy}
                        onClick={() =>
                        {
                            setCollection(key)
                            setEditing(undefined)
                            setMessage('')
                            setError('')
                            setOffset(0)
                            setSearchInput('')
                            setSearch('')
                        }}
                    >
                        {collections[key]}
                    </Button>
                ))}
            </div>

            <div className="catalog-toolbar">
                <label className="checkbox-field">
                    <input
                        type="checkbox"
                        checked={includeArchived}
                        disabled={busy}
                        onChange={event =>
                        {
                            setIncludeArchived(event.target.checked)
                            setEditing(undefined)
                            setSelectedCollege('')
                            setOffset(0)
                        }}
                    />
                    Include archived entries
                </label>

                {collection !== 'colleges' && (
                    <label className="field">College
                        <select
                            value={collegeId}
                            disabled={busy}
                            onChange={event =>
                            {
                                setSelectedCollege(event.target.value)
                                setEditing(undefined)
                                setOffset(0)
                            }}
                        >
                            {!colleges.data?.length && <option value="">Choose a college</option>}
                            {colleges.data?.map(college => (
                                <option key={college.id} value={college.id}>{college.name}</option>
                            ))}
                        </select>
                    </label>
                )}

                <Button disabled={busy} onClick={() => setEditing(null)}>
                    Add {collection.slice(0, -1)}
                </Button>
            </div>

            <form
                className="record-actions"
                onSubmit={event =>
                {
                    event.preventDefault()
                    setSearch(searchInput.trim())
                    setOffset(0)
                }}
            >
                <Field
                    label={`Search ${collection}`}
                    type="search"
                    value={searchInput}
                    onChange={event => setSearchInput(event.target.value)}
                />
                <Button type="submit" variant="secondary">Search</Button>
            </form>

            {message && <FormMessage kind="success">{message}</FormMessage>}
            {error && <FormMessage kind="error">{error}</FormMessage>}

            {editing !== undefined && (
                <form
                    key={editing?.id ?? 'new'}
                    className="workspace-record workspace-form"
                    onSubmit={save}
                >
                    <h2>{editing ? 'Edit entry' : 'New entry'}</h2>

                    {collection === 'courses' ? (
                        <>
                            <label className="field">Department
                                <select
                                    name="departmentId"
                                    required
                                    defaultValue={editing && 'departmentId' in editing ? editing.departmentId : ''}
                                >
                                    <option value="">Choose a department</option>
                                    {activeDepartments.map(department => (
                                        <option key={department.id} value={department.id}>
                                            {department.name}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <Field
                                name="subjectCode"
                                label="Subject code"
                                required
                                maxLength={16}
                                defaultValue={editing && 'subjectCode' in editing ? editing.subjectCode : ''}
                            />
                            <Field
                                name="courseNumber"
                                label="Course number"
                                required
                                maxLength={16}
                                defaultValue={editing && 'courseNumber' in editing ? editing.courseNumber : ''}
                            />
                            <Field
                                name="title"
                                label="Course title"
                                required
                                maxLength={255}
                                defaultValue={editing && 'title' in editing ? editing.title : ''}
                            />
                        </>
                    ) : (
                        <>
                            <Field
                                name="name"
                                label="Name"
                                required
                                maxLength={150}
                                defaultValue={editing && 'name' in editing ? editing.name : ''}
                            />
                            {collection === 'departments' && (
                                <label className="field">Parent college
                                    <select
                                        name="collegeId"
                                        required
                                        defaultValue={editing && 'collegeId' in editing ? editing.collegeId : collegeId}
                                    >
                                        <option value="">Choose a college</option>
                                        {activeColleges.map(college => (
                                            <option key={college.id} value={college.id}>
                                                {college.name}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            )}
                        </>
                    )}

                    <div className="record-actions">
                        <Button type="submit" pending={busy}>Save entry</Button>
                        <Button
                            variant="secondary"
                            disabled={busy}
                            onClick={() => setEditing(undefined)}
                        >
                            Cancel
                        </Button>
                    </div>
                </form>
            )}

            {(records.pending || (collection !== 'colleges' && colleges.pending)) && <LoadingState label="Loading catalog" />}
            {(records.error || colleges.error) && (
                <FormMessage kind="error">{records.error || colleges.error}</FormMessage>
            )}
            {!records.pending && !colleges.pending && !records.error && !colleges.error && !visibleRecords?.length && (
                <EmptyState title="No catalog entries">
                    {search ? 'Try a different search.' : 'Add an entry to this collection to get started.'}
                </EmptyState>
            )}
            <ul className="record-list">
                {visibleRecords?.map(entry => (
                    <li className="workspace-record" key={entry.id}>
                        <h2>{'name' in entry ? entry.name : courseLabel(entry)}</h2>
                        {entry.archivedAt && <StatusLabel tone="attention">Archived</StatusLabel>}

                        <div className="record-actions">
                            <Button
                                variant="secondary"
                                disabled={busy}
                                onClick={() => setEditing(entry)}
                            >
                                Edit
                            </Button>
                            {!entry.archivedAt && !busy && (
                                <ConfirmationDialog
                                    triggerLabel="Archive"
                                    title="Archive this entry?"
                                    description="It will be hidden from active catalog browsing. Existing records are preserved."
                                    confirmLabel="Archive entry"
                                    destructive
                                    onConfirm={() => void archive(entry)}
                                />
                            )}
                        </div>
                    </li>
                ))}
            </ul>

            {collection === 'courses' && (
                <>
                    {(offset > 0 || courses.data?.length === 25) && (
                        <div className="record-actions">
                            <Button
                                variant="secondary"
                                disabled={offset === 0 || busy}
                                onClick={() => setOffset(Math.max(0, offset - 25))}
                            >
                                Previous page
                            </Button>
                            <Button
                                variant="secondary"
                                disabled={courses.data?.length !== 25 || busy}
                                onClick={() => setOffset(offset + 25)}
                            >
                                Next page
                            </Button>
                        </div>
                    )}
                    <CourseImport api={api} onImported={courses.reload} />
                </>
            )}
        </section>
    )
}

/**
 * Preview bounded course imports and retain the submitted text on errors.
 * @param props API client and callback to update the course list.
 * @returns Course import form and preview.
 */
function CourseImport({ api, onImported }: { api: ApiClient; onImported: () => void }) : React.JSX.Element
{
    const [source, setSource] = useState('')
    const [rows, setRows] = useState<CourseInput[]>([])
    const [error, setError] = useState('')
    const [message, setMessage] = useState('')
    const [busy, setBusy] = useState(false)

    /**
     * Parse and validate the source before offering the import action.
     * @param event Preview form submission.
     */
    function preview(event: FormEvent<HTMLFormElement>) : void
    {
        event.preventDefault()
        setMessage('')
        setError('')
        setRows([])

        try
        {
            const parsed: unknown = JSON.parse(source)

            if (!Array.isArray(parsed) || !parsed.length || parsed.length > 100 ||
                new TextEncoder().encode(JSON.stringify(parsed)).length > 16 * 1024)
            {
                throw new Error('Provide 1 to 100 course records in a batch of up to 16 KiB.')
            }

            const codes = new Set<string>()
            const validated = parsed.map((row, index) =>
            {
                if (!row || typeof row.departmentId !== 'string' || !/^[1-9][0-9]*$/.test(row.departmentId) ||
                    typeof row.subjectCode !== 'string' || !row.subjectCode.trim() || row.subjectCode.trim().length > 16 ||
                    typeof row.courseNumber !== 'string' || !row.courseNumber.trim() || row.courseNumber.trim().length > 16 ||
                    typeof row.title !== 'string' || !row.title.trim() || row.title.trim().length > 255)
                {
                    throw new Error(`Row ${index + 1}: Enter a department ID, subject code, course number, and title.`)
                }

                const code = `${row.subjectCode.trim()} ${row.courseNumber.trim()}`.toUpperCase()

                if (codes.has(code))
                {
                    throw new Error(`Row ${index + 1}: Duplicate course code ${code}.`)
                }

                codes.add(code)
                return {
                    departmentId: row.departmentId, subjectCode: row.subjectCode.trim().toUpperCase(),
                    courseNumber: row.courseNumber.trim(), title: row.title.trim(),
                }
            })
            setRows(validated)
        }
        catch (error)
        {
            setError(error instanceof SyntaxError ? 'Enter a valid JSON array.' : (error as Error).message)
        }
    }

    /** Submit the reviewed rows as one import batch. */
    async function importCourses() : Promise<void>
    {
        setBusy(true)
        setError('')

        try
        {
            await api.request('/catalog/courses/import', jsonWrite('POST', rows))
            setMessage(`Imported ${rows.length} ${rows.length === 1 ? 'course' : 'courses'}.`)
            setRows([])
            setSource('')
            onImported()
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
        <section
            className="workspace-record workspace-form"
            aria-labelledby="course-import-heading"
        >
            <h2 id="course-import-heading">Import courses</h2>
            <form className="workspace-form" onSubmit={preview}>
                <label className="field">Course records (JSON)
                    <textarea
                        rows={5}
                        required
                        disabled={busy}
                        value={source}
                        onChange={event =>
                        {
                            setSource(event.target.value)
                            setRows([])
                            setError('')
                            setMessage('')
                        }}
                    />
                </label>
                <p>Include departmentId, subjectCode, courseNumber, and title in each record.</p>
                <Button type="submit" variant="secondary" disabled={busy}>Preview import</Button>
            </form>

            {error && <FormMessage kind="error">{error}</FormMessage>}
            {message && <FormMessage kind="success">{message}</FormMessage>}
            {rows.length > 0 && (
                <>
                    <h3>{rows.length} {rows.length === 1 ? 'course' : 'courses'} ready for review</h3>
                    <ol className="import-preview">
                        {rows.map(row => (
                            <li key={`${row.subjectCode} ${row.courseNumber}`}>
                                {row.subjectCode} {row.courseNumber} — {row.title} · Department {row.departmentId}
                            </li>
                        ))}
                    </ol>
                    <Button pending={busy} onClick={() => void importCourses()}>
                        Import reviewed courses
                    </Button>
                </>
            )}
        </section>
    )
}
