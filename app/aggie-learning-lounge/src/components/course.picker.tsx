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

import { courseLabel, readJson, type Course } from '../api/catalog.js'
import type { ApiClient } from '../api/client.js'
import { useResource } from '../hooks/use.resource.js'
import { Button, Field } from './ui/controls.js'
import { FormMessage, LoadingState } from './ui/feedback.js'

/**
 * Find a course by code or title and pass it to an assignment form.
 * @param props API client, selected course IDs, and selection handler.
 * @returns Search and course selection controls.
 */
export function CoursePicker({ api, selected, disabled, onSelect }: {
    api: ApiClient
    selected: readonly string[]
    disabled?: boolean
    onSelect: (course: Course) => void
}) : React.JSX.Element
{
    const [draft, setDraft] = useState('')
    const [search, setSearch] = useState('')
    const [offset, setOffset] = useState(0)
    const results = useResource(useCallback((signal: AbortSignal) =>
        readJson<Course[]>(api, `/catalog/courses?${new URLSearchParams({
            search, offset: String(offset), limit: '10',
        })}`, { signal }), [api, offset, search]))

    /**
     * Apply the search and return to its first page.
     * @param event Course search form submission.
     */
    function submit(event: FormEvent<HTMLFormElement>) : void
    {
        event.preventDefault()
        setSearch(draft.trim())
        setOffset(0)
    }

    return (
        <section className="workspace-form" aria-label="Find courses to assign">
            <form className="record-actions" onSubmit={submit}>
                <Field
                    label="Find a course"
                    type="search"
                    value={draft}
                    onChange={event => setDraft(event.target.value)}
                />
                <Button type="submit" variant="secondary">Search courses</Button>
            </form>

            {results.pending && <LoadingState label="Loading courses" />}
            {results.error && <FormMessage kind="error">{results.error}</FormMessage>}
            {results.data?.length === 0 && <p>No courses match this search.</p>}
            <ul className="picker-results">
                {results.data?.map(course => (
                    <li className="picker-result" key={course.id}>
                        <span>{courseLabel(course)}</span>
                        <Button
                            variant="secondary"
                            disabled={disabled || selected.includes(course.id)}
                            aria-label={`Select ${courseLabel(course)}`}
                            onClick={() => onSelect(course)}
                        >
                            {selected.includes(course.id) ? 'Selected' : 'Select'}
                        </Button>
                    </li>
                ))}
            </ul>

            {(offset > 0 || results.data?.length === 10) && (
                <div className="record-actions">
                    <Button
                        variant="secondary"
                        disabled={offset === 0}
                        onClick={() => setOffset(Math.max(0, offset - 10))}
                    >
                        Previous page
                    </Button>
                    <Button
                        variant="secondary"
                        disabled={results.data?.length !== 10}
                        onClick={() => setOffset(offset + 10)}
                    >
                        Next page
                    </Button>
                </div>
            )}
        </section>
    )
}
