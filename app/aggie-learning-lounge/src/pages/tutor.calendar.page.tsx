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

import { jsonWrite, readJson, requestMessage } from '../api/catalog.js'
import type { ApiClient } from '../api/client.js'
import {
    addDays, bookingCourseLabels, calendarWindow, campusDay, campusInput, campusToUtc,
    formatCampusTime, formatDay, type AvailabilityBlock, type Booking, type TutorCalendar,
} from '../api/scheduling.js'
import { BookingRecord } from '../components/schedule.records.js'
import { ConfirmationDialog } from '../components/ui/confirmation.dialog.js'
import { Button, Field } from '../components/ui/controls.js'
import { EmptyState, FormMessage, LoadingState, StatusLabel } from '../components/ui/feedback.js'
import { useResource } from '../hooks/use.resource.js'

/**
 * Find the Monday belonging to a campus calendar day.
 * @param day Calendar day in YYYY-MM-DD form.
 * @returns First day of the displayed week.
 */
function mondayOf(day: string) : string
{
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay()
    return addDays(day, -((weekday + 6) % 7))
}

/**
 * Show a tutor's agenda and let them manage their available time.
 * @param props Shared API client and tutor's account ID.
 * @returns Tutor calendar workspace.
 */
export default function TutorCalendarPage({ api, actorId }: { api: ApiClient; actorId?: string }) : React.JSX.Element
{
    const [day, setDay] = useState(campusDay)
    const [editing, setEditing] = useState<AvailabilityBlock | null | undefined>()
    const [busy, setBusy] = useState(false)
    const [message, setMessage] = useState('')
    const [error, setError] = useState('')
    const week = mondayOf(day)
    const load = useCallback(async (signal: AbortSignal) =>
    {
        const window = await calendarWindow(week, 7)
        const calendar = await readJson<TutorCalendar>(
            api, `/availability/tutors/${actorId}/calendar?${new URLSearchParams(window)}`, { authenticated: true, signal },
        )
        const labels = await bookingCourseLabels(api, calendar.bookings, signal)
        return { ...calendar, labels }
    }, [actorId, api, week])
    const calendar = useResource(actorId ? load : null)
    const days = Array.from({ length: 7 }, (_, index) => addDays(week, index))

    /**
     * Select an Eastern calendar day.
     * @param value Date chosen in the picker or week controls.
     */
    function selectDay(value: string) : void
    {
        if (value)
        {
            setDay(value)
            setEditing(undefined)
        }
    }

    /**
     * Save a new or edited availability block.
     * @param event Availability form submission.
     */
    async function saveBlock(event: FormEvent<HTMLFormElement>) : Promise<void>
    {
        event.preventDefault()
        const values = new FormData(event.currentTarget)
        setBusy(true)
        setError('')
        setMessage('')

        try
        {
            const startsAt = await campusToUtc(String(values.get('startsAt')))
            const endsAt = await campusToUtc(String(values.get('endsAt')))
            const location = String(values.get('location')).trim()

            if (Date.parse(endsAt) <= Date.parse(startsAt) || !location)
            {
                throw new Error('Enter an end after the start and provide a location.')
            }

            const path = editing ? `/availability/blocks/${editing.id}` : '/availability/blocks'
            await api.request(path, jsonWrite(editing ? 'PATCH' : 'POST', { startsAt, endsAt, location }))
            setEditing(undefined)
            setMessage('Availability saved.')
            selectDay(campusDay(startsAt))
            calendar.reload()
        }
        catch (error)
        {
            setError(error instanceof Error ? error.message : 'Unable to save availability.')
        }
        finally
        {
            setBusy(false)
        }
    }

    /**
     * Remove bookable time while leaving confirmed bookings intact.
     * @param id Availability block to withdraw.
     */
    async function withdraw(id: string) : Promise<void>
    {
        setBusy(true)
        setError('')
        setMessage('')

        try
        {
            await api.request(`/availability/blocks/${id}`, { method: 'DELETE', authenticated: true })
            setEditing(undefined)
            setMessage('Availability withdrawn. Confirmed bookings are still scheduled.')
            calendar.reload()
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
     * Cancel a confirmed tutoring session and refresh the agenda.
     * @param id Booking to cancel.
     */
    async function cancelBooking(id: string) : Promise<void>
    {
        setMessage('')
        await api.request(`/bookings/${id}`, { method: 'DELETE', authenticated: true })
        setMessage('Session canceled.')
        calendar.reload()
    }

    return (
        <section className="catalog-section page-width">
            <h1 className="workspace-heading">Tutor calendar</h1>
            <p>Availability and confirmed bookings are shown in Eastern time.</p>

            <div className="record-actions calendar-controls">
                <Field
                    label="Calendar date"
                    type="date"
                    value={day}
                    disabled={busy}
                    onChange={event => selectDay(event.target.value)}
                />
                <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => selectDay(addDays(day, -7))}
                >
                    Previous week
                </Button>
                <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => selectDay(addDays(day, 7))}
                >
                    Next week
                </Button>
                <Button disabled={busy} onClick={() => setEditing(null)}>Add availability</Button>
            </div>

            {message && <FormMessage kind="success">{message}</FormMessage>}
            {error && <FormMessage kind="error">{error}</FormMessage>}
            {editing !== undefined && (
                <form
                    key={editing?.id ?? 'new'}
                    className="workspace-record workspace-form"
                    onSubmit={saveBlock}
                >
                    <h2>{editing ? 'Edit availability' : 'New availability'}</h2>
                    <Field
                        label="Starts (Eastern time)"
                        name="startsAt"
                        type="datetime-local"
                        required
                        defaultValue={editing ? campusInput(editing.startsAt) : `${day}T09:00`}
                    />
                    <Field
                        label="Ends (Eastern time)"
                        name="endsAt"
                        type="datetime-local"
                        required
                        defaultValue={editing ? campusInput(editing.endsAt) : `${day}T10:00`}
                    />
                    <Field
                        label="Location or meeting link"
                        name="location"
                        required
                        maxLength={2048}
                        defaultValue={editing?.location}
                    />
                    <div className="record-actions">
                        <Button type="submit" pending={busy}>Save availability</Button>
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

            {calendar.pending && <LoadingState label="Loading tutor calendar" />}
            {calendar.error && (
                <div>
                    <FormMessage kind="error">{calendar.error}</FormMessage>
                    <Button variant="secondary" onClick={calendar.reload}>Try again</Button>
                </div>
            )}
            {calendar.data && (
                <div className="tutor-week" aria-label="Tutor calendar week">
                    {days.map(date =>
                    {
                        const blocks = calendar.data?.blocks.filter(block =>
                            campusDay(block.startsAt) <= date && campusDay(new Date(Date.parse(block.endsAt) - 1)) >= date) ?? []
                        const bookings = calendar.data?.bookings.filter(booking => campusDay(booking.startsAt) === date) ?? []
                        const records: ({ block: AvailabilityBlock; startsAt: string } | { booking: Booking; startsAt: string })[] = [
                            ...blocks.map(block => ({ block, startsAt: block.startsAt })),
                            ...bookings.map(booking => ({ booking, startsAt: booking.startsAt })),
                        ]
                        records.sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt))

                        return (
                            <section
                                className="calendar-day"
                                data-selected={day === date}
                                key={date}
                                aria-label={formatDay(date)}
                            >
                                <h2>{formatDay(date)}</h2>
                                {records.length === 0 && (
                                    <EmptyState title="No calendar entries">
                                        No availability or bookings for this date.
                                    </EmptyState>
                                )}
                                {records.map(record =>
                                {
                                    if ('booking' in record)
                                    {
                                        const booking = record.booking

                                        return (
                                            <BookingRecord
                                                key={`booking-${booking.id}`}
                                                booking={booking}
                                                title={calendar.data?.labels[booking.courseId] ?? `Course ${booking.courseId}`}
                                                actorId={actorId}
                                                onCancel={() => cancelBooking(booking.id)}
                                            />
                                        )
                                    }

                                    const block = record.block

                                    return (
                                        <article
                                            className="workspace-record schedule-record"
                                            key={`block-${block.id}`}
                                        >
                                            <h3>Availability</h3>
                                            <StatusLabel>Open block</StatusLabel>
                                            <p>
                                                {formatCampusTime(block.startsAt)} to {formatCampusTime(block.endsAt)}
                                            </p>
                                            <p>{block.location}</p>
                                            <div className="record-actions">
                                                <Button
                                                    variant="secondary"
                                                    disabled={busy}
                                                    onClick={() => setEditing(block)}
                                                >
                                                    Edit
                                                </Button>
                                                {!busy && (
                                                    <ConfirmationDialog
                                                        triggerLabel="Withdraw"
                                                        title="Withdraw this availability?"
                                                        description="Students can’t book new sessions in this block. Confirmed bookings stay scheduled."
                                                        confirmLabel="Withdraw availability"
                                                        destructive
                                                        onConfirm={() => void withdraw(block.id)}
                                                    />
                                                )}
                                            </div>
                                        </article>
                                    )
                                })}
                            </section>
                        )
                    })}
                </div>
            )}
        </section>
    )
}
