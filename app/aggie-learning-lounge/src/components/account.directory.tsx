import { useCallback, useId, useState, type FormEvent } from 'react'

import { readJson } from '../api/catalog.js'
import type { ApiClient } from '../api/client.js'
import { formatCampusTime } from '../api/scheduling.js'
import { useResource } from '../hooks/use.resource.js'
import { Button, Field } from './ui/controls.js'
import { EmptyState, FormMessage, LoadingState } from './ui/feedback.js'

export type DirectoryProfile = {
    id: string
    firstName: string
    lastName: string
    email: string
    emailVerifiedAt: string | null
    createdAt: string
}

const pageSize = 25

/**
 * Show an admin directory row with a per-account ID disclosure.
 * @param props Account profile and callback to open the editor.
 * @returns One row of the account directory.
 */
function DirectoryRow({ account, role, onEdit }: {
    account: DirectoryProfile
    role: string
    onEdit: (account: DirectoryProfile) => void
}) : React.JSX.Element
{
    const [showId, setShowId] = useState(false)
    const idLabel = useId()
    const name = `${account.firstName} ${account.lastName}`

    return (
        <tr>
            <th scope="row">
                {name}

                <Button variant="quiet" aria-label={`Edit ${name}`} onClick={() => onEdit(account)}>
                    Edit
                </Button>
            </th>
            <td>
                <Button
                    variant="quiet"
                    className="account-id-toggle"
                    aria-label={`${showId ? 'Hide' : 'Show'} ${role} ID for ${name}`}
                    aria-expanded={showId}
                    aria-controls={idLabel}
                    onClick={() => setShowId(current => !current)}
                >
                    <svg
                        aria-hidden="true"
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    >
                        <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
                        <circle cx="12" cy="12" r="2.5" />
                        {showId && <path d="M3 3l18 18" />}
                    </svg>
                </Button>

                <span id={idLabel} hidden={!showId}>{showId && account.id}</span>
            </td>
            <td>
                <dl className="account-metadata">
                    <div>
                        <dt>Email</dt>
                        <dd>{account.email}</dd>
                    </div>
                    <div>
                        <dt>Verified</dt>
                        <dd>{account.emailVerifiedAt ? formatCampusTime(account.emailVerifiedAt) : 'Unverified'}</dd>
                    </div>
                    <div>
                        <dt>Created</dt>
                        <dd>{formatCampusTime(account.createdAt)}</dd>
                    </div>
                </dl>
            </td>
        </tr>
    )
}

/**
 * Search and page through account profiles for the admin workspace.
 * @param props Shared API client, visibility, and account selection callback.
 * @returns Search form, results table, and page controls.
 */
export function AccountDirectory({ api, active, role, revision = 0, onEdit }: {
    api: ApiClient
    active: boolean
    role: 'tutor' | 'student'
    revision?: number
    onEdit: (account: DirectoryProfile) => void
}) : React.JSX.Element
{
    const [draft, setDraft] = useState('')
    const [search, setSearch] = useState('')
    const [offset, setOffset] = useState(0)
    const roleLabel = role === 'tutor' ? 'Tutor' : 'Student'
    const captionId = useId()

    const loadAccounts = useCallback((signal: AbortSignal) =>
    {
        // Request one extra row so an exact final page has no Next button.
        const query = new URLSearchParams({ search, limit: String(pageSize + 1), offset: String(offset) })
        const path = role === 'tutor' ? '/tutors/admin' : '/users/students'
        return readJson<DirectoryProfile[]>(api, `${path}?${query}`, { signal, authenticated: true })
    }, [api, search, offset, role, revision])
    const accounts = useResource(active ? loadAccounts : null)
    const hasNextPage = (accounts.data?.length ?? 0) > pageSize

    /**
     * Apply the submitted search and return to the first page.
     * @param event Directory search form submission.
     */
    function submit(event: FormEvent<HTMLFormElement>) : void
    {
        event.preventDefault()
        setSearch(draft.trim())
        setOffset(0)
    }

    return (
        <section className="workspace-form" aria-label={`${roleLabel} ${role === 'tutor' ? 'directory' : 'catalog'}`}>
            <form className="record-actions" onSubmit={submit}>
                <Field
                    label="Search by first or last name"
                    type="search"
                    maxLength={301}
                    value={draft}
                    onChange={event => setDraft(event.target.value)}
                />
                <Button type="submit" variant="secondary">Search</Button>
            </form>

            {accounts.pending && <LoadingState label={`Loading ${role}s`} />}
            {accounts.error && (
                <div>
                    <FormMessage kind="error">{accounts.error}</FormMessage>
                    <Button variant="secondary" onClick={accounts.reload}>Try again</Button>
                </div>
            )}
            {accounts.data?.length === 0 && (
                <EmptyState title={`No ${role}s found`}>
                    {search ? 'Try a different first or last name.' : role === 'tutor'
                        ? 'Provision a tutor to add them to the directory.' : 'No student accounts are registered yet.'}
                </EmptyState>
            )}

            {accounts.data && accounts.data.length > 0 && (
                <div
                    className="account-directory-table"
                    role="region"
                    aria-labelledby={captionId}
                    tabIndex={0}
                >
                    <table>
                        <caption id={captionId} className="visually-hidden">{roleLabel} search results</caption>
                        <thead>
                            <tr>
                                <th scope="col">{roleLabel}</th>
                                <th scope="col">Account ID</th>
                                <th scope="col">Account details</th>
                            </tr>
                        </thead>
                        <tbody>
                            {accounts.data.slice(0, pageSize).map(account => (
                                <DirectoryRow key={account.id} account={account} role={role} onEdit={onEdit} />
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {(offset > 0 || hasNextPage) && (
                <div className="record-actions">
                    <Button
                        variant="secondary"
                        disabled={offset === 0 || accounts.pending}
                        onClick={() => setOffset(current => current - pageSize)}
                    >
                        Previous page
                    </Button>
                    <Button
                        variant="secondary"
                        disabled={!hasNextPage || accounts.pending}
                        onClick={() => setOffset(current => current + pageSize)}
                    >
                        Next page
                    </Button>
                </div>
            )}
        </section>
    )
}
