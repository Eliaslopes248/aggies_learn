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

import { useCallback, useState } from 'react'
import { Link } from 'react-router'

import { authLink } from '../api/auth.navigation.js'
import { jsonWrite, readJson, requestMessage, type Tutor } from '../api/catalog.js'
import { ApiError, type ApiClient, type Profile } from '../api/client.js'
import { addDays, calendarWindow, campusDay, formatCampusTime, type Booking, type Slot } from '../api/scheduling.js'
import { useResource } from '../hooks/use.resource.js'
import { BookingRecord } from './schedule.records.js'
import { ConfirmationDialog } from './ui/confirmation.dialog.js'
import { Button, Field } from './ui/controls.js'
import { EmptyState, FormMessage, LoadingState } from './ui/feedback.js'

/**
 * Show chronological bookable times and let a verified student review one.
 * @param props Course, tutor roster, current profile, and return path.
 * @returns Student slot picker and confirmation.
 */
export default function CourseSlots({ api, courseId, title, tutors, profile, returnTo }: {
    api: ApiClient
    courseId: string
    title: string
    tutors: Tutor[]
    profile: Profile | null
    returnTo: string
}) : React.JSX.Element
{
    const today = campusDay()
    const [day, setDay] = useState(today)
    const [selected, setSelected] = useState<Slot | null>(null)
    const [booking, setBooking] = useState<Booking | null>(null)
    const [confirmed, setConfirmed] = useState(false)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')

    const canBook = Boolean(profile?.roles.includes('student') && profile.emailVerifiedAt)
    const tutorNames = Object.fromEntries(tutors.map(tutor => [tutor.id, `${tutor.firstName} ${tutor.lastName}`]))

    const slots = useResource(useCallback(async (signal: AbortSignal) =>
    {
        const window = await calendarWindow(day, 1)
        return readJson<Slot[]>(api, `/availability/courses/${courseId}/slots?${new URLSearchParams(window)}`, {
            signal, authenticated: true,
        })
    }, [api, courseId, day]))

    /**
     * Change the visible day and discard any selection from the previous day.
     * @param next Calendar date selected by the student.
     */
    function changeDay(next: string) : void
    {
        if (next && next >= today)
        {
            setDay(next)
            setSelected(null)
            setError('')
        }
    }

    /** Save a reviewed slot and fetch its private details only after commitment. */
    async function confirmBooking() : Promise<void>
    {
        if (!selected || !canBook || busy || confirmed)
        {
            return
        }

        setBusy(true)
        setError('')

        try
        {
            const { id } = await readJson<{ id: string }>(api, '/bookings', jsonWrite('POST', {
                courseId, ...selected,
            }))
            setConfirmed(true)
            setSelected(null)

            // A failed detail read must not cause the student to submit a second booking.
            const details = await readJson<Booking>(api, `/bookings/${id}`, { authenticated: true }).catch(() => null)
            setBooking(details)
        }
        catch (error)
        {
            if (error instanceof ApiError && error.status === 409)
            {
                setSelected(null)
                slots.reload()
                setError('That time is no longer available. Choose another time.')
            }
            else
            {
                setError(requestMessage(error))
            }
        }
        finally
        {
            setBusy(false)
        }
    }

    if (confirmed)
    {
        return (
            <section className="schedule-panel booking-confirmation" aria-labelledby="booking-confirmed">
                <h2 id="booking-confirmed">Booking confirmed</h2>
                {booking && <BookingRecord booking={booking} title={title} />}
                <Link to="/sessions" className="button button--primary">View My Sessions</Link>
            </section>
        )
    }

    return (
        <section className="schedule-panel" aria-labelledby="available-times">
            <h2 id="available-times">Available times</h2>
            <p>Times are shown in Eastern time.</p>

            <div className="record-actions">
                <Field
                    label="Session date"
                    type="date"
                    min={today}
                    value={day}
                    disabled={busy}
                    onChange={event => changeDay(event.target.value)}
                />
                <Button
                    variant="secondary"
                    disabled={busy || day <= today}
                    onClick={() => changeDay(addDays(day, -1))}
                >
                    Previous day
                </Button>
                <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => changeDay(addDays(day, 1))}
                >
                    Next day
                </Button>
            </div>

            {profile?.roles.includes('student') && !profile.emailVerifiedAt && (
                <p>
                    {'Verify your email before booking. '}
                    <Link className="text-link" to={authLink('/verify-email', returnTo)}>
                        Verify your email
                    </Link>
                </p>
            )}
            {profile && !profile.roles.includes('student') && (
                <p>A student role is required to book a session.</p>
            )}
            {error && <FormMessage kind="error">{error}</FormMessage>}
            {slots.pending && <LoadingState label="Loading available times" />}
            {slots.error && (
                <div>
                    <FormMessage kind="error">{slots.error}</FormMessage>
                    <Button variant="secondary" onClick={slots.reload}>Try again</Button>
                </div>
            )}
            {slots.data?.length === 0 && (
                <EmptyState title="No times available">
                    Choose another date to check for tutoring times.
                </EmptyState>
            )}

            <ul className="slot-list">
                {slots.data?.slice().sort((left, right) => left.startsAt.localeCompare(right.startsAt)).map(slot =>
                {
                    const active = selected?.startsAt === slot.startsAt &&
                        selected?.availabilityBlockId === slot.availabilityBlockId

                    return (
                        <li key={`${slot.availabilityBlockId}:${slot.startsAt}`}>
                            <Button
                                variant={active ? 'primary' : 'secondary'}
                                aria-pressed={active}
                                disabled={busy}
                                onClick={() => setSelected(slot)}
                            >
                                {formatCampusTime(slot.startsAt)} · {tutorNames[slot.tutorId] ?? 'Tutor'}
                            </Button>
                        </li>
                    )
                })}
            </ul>

            {selected && (
                <div className="workspace-record schedule-review">
                    <h3>Selected time</h3>
                    <p>{title} · {tutorNames[selected.tutorId] ?? 'Tutor'}</p>
                    <p>Time: <strong>{formatCampusTime(selected.startsAt)} to {formatCampusTime(selected.endsAt)}</strong></p>
                    {canBook && !busy && (
                        <ConfirmationDialog
                            triggerLabel="Review booking"
                            title="Confirm this tutoring session"
                            description={
                                <>
                                    {title} with {tutorNames[selected.tutorId] ?? 'your tutor'}.
                                    <br />
                                    Time: <strong>{formatCampusTime(selected.startsAt)} to {formatCampusTime(selected.endsAt)}</strong>
                                </>
                            }
                            confirmLabel="Book session"
                            onConfirm={() => void confirmBooking()}
                        />
                    )}
                    {busy && <LoadingState label="Confirming booking" />}
                </div>
            )}
        </section>
    )
}
