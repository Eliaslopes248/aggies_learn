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

import { readJson } from '../api/catalog.js'
import { ApiError, type ApiClient } from '../api/client.js'
import { addDays, bookingCourseLabels, campusToUtc, formatCampusTime, type Booking } from '../api/scheduling.js'
import { BookingLocation } from '../components/schedule.records.js'
import { Button, Field } from '../components/ui/controls.js'
import { EmptyState, FormMessage, LoadingState, StatusLabel } from '../components/ui/feedback.js'
import { useResource } from '../hooks/use.resource.js'

const pageSize = 25
const maximumWindowMs = 31 * 24 * 60 * 60 * 1000

type Filters = {
    courseId?: string
    tutorId?: string
    participantId?: string
    startsOn?: string
    endsOn?: string
    status: 'all' | 'confirmed' | 'canceled'
}

/**
 * Read an optional positive MySQL ID without rounding large IDs.
 * @param fields Submitted support fields.
 * @param key Name of the ID field.
 * @param label Visible field name.
 * @returns Trimmed ID or undefined.
 */
function readId(fields: FormData, key: string, label: string) : string | undefined
{
    const id = String(fields.get(key) ?? '').trim()

    if (!id)
    {
        return undefined
    }

    if (!/^[1-9][0-9]{0,18}$/.test(id) || BigInt(id) > 9_223_372_036_854_775_807n)
    {
        throw new Error(`${label} must be a valid positive ID.`)
    }

    return id
}

/**
 * Serialize support filters with an inclusive Eastern date range.
 * @param filters Applied support filters.
 * @param offset Record offset for the current page.
 * @returns Query understood by the booking API.
 */
async function bookingQuery(filters: Filters, offset: number) : Promise<URLSearchParams>
{
    const query = new URLSearchParams({
        limit: String(pageSize),
        offset: String(offset),
        includeCanceled: String(filters.status !== 'confirmed'),
    })

    if (filters.status === 'canceled')
    {
        query.set('canceledOnly', 'true')
    }

    for (const key of ['courseId', 'tutorId', 'participantId'] as const)
    {
        const id = filters[key]

        if (id)
        {
            query.set(key, id)
        }
    }

    if (filters.startsOn && filters.endsOn)
    {
        const [start, end] = await Promise.all([
            campusToUtc(`${filters.startsOn}T00:00`),
            campusToUtc(`${addDays(filters.endsOn, 1)}T00:00`),
        ])
        const duration = Date.parse(end) - Date.parse(start)

        if (duration <= 0 || duration > maximumWindowMs)
        {
            throw new Error('Choose an Eastern date range of up to 31 days.')
        }

        query.set('startsAt', start)
        query.set('endsAt', end)
    }

    return query
}

/**
 * Render the status carried on a booking.
 * @param props Booking to summarize.
 * @returns Visible status label.
 */
function BookingStatus({ booking }: { booking: Booking }) : React.JSX.Element
{
    return (
        <StatusLabel tone={booking.canceledAt ? 'negative' : 'positive'}>
            {booking.canceledAt ? 'Canceled' : 'Confirmed'}
        </StatusLabel>
    )
}

/**
 * Reveal support details without increasing row height by default.
 * @param props Authorized booking record.
 * @returns Disclosure containing booked time and location.
 */
function SupportDetails({ booking }: { booking: Booking }) : React.JSX.Element
{
    return (
        <details className="support-details">
            <summary aria-label={`Details for booking ${booking.id}`}>Details</summary>
            <p>Ends {formatCampusTime(booking.endsAt)}</p>
            {booking.canceledAt && <p>Canceled {formatCampusTime(booking.canceledAt)}</p>}
            <BookingLocation location={booking.location} />
        </details>
    )
}

/**
 * Present the same booking results as a desktop table and labeled mobile cards.
 * @param props Booking rows and catalog labels for those rows.
 * @returns Responsive result views.
 */
function BookingResults({ rows, labels }: { rows: Booking[]; labels: Record<string, string> }) : React.JSX.Element
{
    return (
        <>
            <div
                className="support-table"
                role="region"
                aria-labelledby="bookings-caption"
                tabIndex={0}
            >
                <table>
                    <caption id="bookings-caption" className="visually-hidden">
                        Booking search results
                    </caption>
                    <thead>
                        <tr>
                            <th scope="col">Booking</th>
                            <th scope="col">Course</th>
                            <th scope="col">Starts</th>
                            <th scope="col">Tutor ID</th>
                            <th scope="col">Student ID</th>
                            <th scope="col">Status</th>
                            <th scope="col">Details</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(booking => (
                            <tr key={booking.id}>
                                <th scope="row">#{booking.id}</th>
                                <td>{labels[booking.courseId]}</td>
                                <td>{formatCampusTime(booking.startsAt)}</td>
                                <td>{booking.tutorId}</td>
                                <td>{booking.studentId}</td>
                                <td>
                                    <BookingStatus booking={booking} />
                                </td>
                                <td>
                                    <SupportDetails booking={booking} />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <ul className="record-list support-cards" aria-label="Booking search results">
                {rows.map(booking => (
                    <li className="workspace-record support-card" key={booking.id}>
                        <div className="support-card-heading">
                            <h3>Booking #{booking.id}</h3>
                            <BookingStatus booking={booking} />
                        </div>
                        <dl>
                            <div>
                                <dt>Course</dt>
                                <dd>{labels[booking.courseId]}</dd>
                            </div>
                            <div>
                                <dt>Starts</dt>
                                <dd>{formatCampusTime(booking.startsAt)}</dd>
                            </div>
                            <div>
                                <dt>Tutor ID</dt>
                                <dd>{booking.tutorId}</dd>
                            </div>
                            <div>
                                <dt>Student ID</dt>
                                <dd>{booking.studentId}</dd>
                            </div>
                        </dl>
                        <SupportDetails booking={booking} />
                    </li>
                ))}
            </ul>
        </>
    )
}

/**
 * Browse and filter bookings for the current admin account.
 * @param props Shared API client.
 * @returns Admin booking support workspace.
 */
export default function AdminBookingsPage({ api }: { api: ApiClient }) : React.JSX.Element
{
    const [filters, setFilters] = useState<Filters>({ status: 'all' })
    const [offset, setOffset] = useState(0)
    const [validationError, setValidationError] = useState('')

    const bookings = useResource(useCallback(async (signal: AbortSignal) =>
    {
        const query = await bookingQuery(filters, offset)

        try
        {
            const rows = await readJson<Booking[]>(api, `/bookings/admin?${query}`, { authenticated: true, signal })
            const labels = await bookingCourseLabels(api, rows, signal)
            return { rows, labels, denied: false }
        }
        catch (error)
        {
            if (error instanceof ApiError && error.status === 403)
            {
                return { rows: [], labels: {}, denied: true }
            }

            throw error
        }
    }, [api, filters, offset]))

    /**
     * Check the submitted filters and return to the first page.
     * @param event Booking filters form submission.
     */
    function applyFilters(event: FormEvent<HTMLFormElement>) : void
    {
        event.preventDefault()
        const fields = new FormData(event.currentTarget)
        setValidationError('')

        try
        {
            const startsOn = String(fields.get('startsOn') ?? '')
            const endsOn = String(fields.get('endsOn') ?? '')

            if (Boolean(startsOn) !== Boolean(endsOn) || (startsOn && endsOn < startsOn))
            {
                throw new Error('Enter both dates with the end on or after the start.')
            }

            const status = fields.get('status')
            setFilters({
                courseId: readId(fields, 'courseId', 'Course ID'),
                tutorId: readId(fields, 'tutorId', 'Tutor account ID'),
                participantId: readId(fields, 'participantId', 'Participant account ID'),
                startsOn,
                endsOn,
                status: status === 'confirmed' || status === 'canceled' ? status : 'all',
            })
            setOffset(0)
        }
        catch (error)
        {
            setValidationError(error instanceof Error ? error.message : 'Check the booking filters.')
        }
    }

    /** Restore the default search and first page. */
    function clearFilters() : void
    {
        setValidationError('')
        setFilters({ status: 'all' })
        setOffset(0)
    }

    return (
        <section className="catalog-section page-width">
            <h1 className="workspace-heading">Manage bookings</h1>
            <p>Find tutoring sessions for support. Date filters use Eastern time.</p>

            <form
                className="workspace-record support-filter-form"
                onSubmit={applyFilters}
                onReset={clearFilters}
            >
                <div className="support-filter-fields">
                    <Field label="Course ID" name="courseId" inputMode="numeric" />
                    <Field label="Tutor account ID" name="tutorId" inputMode="numeric" />
                    <Field
                        label="Participant account ID"
                        name="participantId"
                        inputMode="numeric"
                    />
                    <Field label="From date" name="startsOn" type="date" />
                    <Field label="Through date" name="endsOn" type="date" />
                    <label className="field">
                        Status
                        <select name="status" defaultValue="all">
                            <option value="all">All bookings</option>
                            <option value="confirmed">Confirmed only</option>
                            <option value="canceled">Canceled only</option>
                        </select>
                    </label>
                </div>

                {validationError && <FormMessage kind="error">{validationError}</FormMessage>}
                <div className="record-actions">
                    <Button type="submit">Apply filters</Button>
                    <Button type="reset" variant="secondary">Clear filters</Button>
                </div>
            </form>

            <section className="support-results" aria-label="Results" aria-busy={bookings.pending}>
                {bookings.pending && <LoadingState label="Loading bookings" />}
                {bookings.error && (
                    <div className="workspace-record">
                        <FormMessage kind="error">{bookings.error}</FormMessage>
                        <Button variant="secondary" onClick={bookings.reload}>Try again</Button>
                    </div>
                )}
                {bookings.data?.denied && (
                    <EmptyState title="Access restricted">
                        A current admin role is required to view booking support records.
                    </EmptyState>
                )}
                {bookings.data && !bookings.data.denied && bookings.data.rows.length === 0 && (
                    <EmptyState title="No matching bookings">
                        Try a different date range or remove a filter.
                    </EmptyState>
                )}
                {bookings.data && bookings.data.rows.length > 0 && (
                    <BookingResults rows={bookings.data.rows} labels={bookings.data.labels} />
                )}
            </section>

            {!bookings.data?.denied && (offset > 0 || bookings.data?.rows.length === pageSize) && (
                <div className="record-actions" aria-label="Booking result pages">
                    <Button
                        variant="secondary"
                        disabled={bookings.pending || offset === 0}
                        onClick={() => setOffset(offset - pageSize)}
                    >
                        Previous page
                    </Button>
                    <span>Page {Math.floor(offset / pageSize) + 1}</span>
                    <Button
                        variant="secondary"
                        disabled={bookings.data?.rows.length !== pageSize}
                        onClick={() => setOffset(offset + pageSize)}
                    >
                        Next page
                    </Button>
                </div>
            )}
        </section>
    )
}
