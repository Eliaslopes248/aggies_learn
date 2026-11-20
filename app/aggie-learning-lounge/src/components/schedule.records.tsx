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

import { useState } from 'react'

import { formatCampusTime, type Booking } from '../api/scheduling.js'
import { ConfirmationDialog } from './ui/confirmation.dialog.js'
import { FormMessage, StatusLabel } from './ui/feedback.js'

/**
 * Show a confirmed location or a web meeting link.
 * @param props Location stored on the booking.
 * @returns A safe link or a plain location label.
 */
export function BookingLocation({ location }: { location: string }) : React.JSX.Element
{
    const link = URL.canParse(location) ? new URL(location) : null

    if (link?.protocol === 'https:' || link?.protocol === 'http:')
    {
        return (
            <p>
                Location: <a
                    className="text-link booking-location-link"
                    href={link.href}
                    target="_blank"
                    rel="noreferrer"
                >
                    Open meeting link
                </a>
            </p>
        )
    }

    return <p>Location: <strong>{location}</strong></p>
}

/**
 * Render booking details for an authorized participant.
 * @param props Confirmed booking, viewer context, and optional cancel action.
 * @returns Booking summary.
 */
export function BookingRecord({ booking, title, actorId, onCancel }: {
    booking: Booking
    title: string
    actorId?: string
    onCancel?: () => Promise<void>
}) : React.JSX.Element
{
    const [openedAt] = useState(Date.now)
    const [canceling, setCanceling] = useState(false)
    const [error, setError] = useState('')
    const canCancel = onCancel && !booking.canceledAt && Date.parse(booking.startsAt) > openedAt

    /** Cancel from the confirmation dialog and display a retryable error if needed. */
    async function cancel() : Promise<void>
    {
        setCanceling(true)
        setError('')

        try
        {
            await onCancel?.()
        }
        catch (error)
        {
            setError(error instanceof Error ? error.message : 'Unable to cancel this session.')
        }
        finally
        {
            setCanceling(false)
        }
    }

    return (
        <article className="workspace-record schedule-record">
            <h3>{title}</h3>
            <StatusLabel tone={booking.canceledAt ? 'negative' : 'positive'}>
                {booking.canceledAt ? 'Canceled' : 'Confirmed'}
            </StatusLabel>
            <p>Time: <strong>{formatCampusTime(booking.startsAt)} to {formatCampusTime(booking.endsAt)}</strong></p>
            {actorId && (
                <p>
                    {booking.tutorId === actorId ? `Student account ${booking.studentId}` : `Tutor account ${booking.tutorId}`}
                </p>
            )}
            {!booking.canceledAt && <BookingLocation location={booking.location} />}
            {error && <FormMessage kind="error">{error}</FormMessage>}
            {canceling && <FormMessage>Canceling session…</FormMessage>}
            {canCancel && !canceling && (
                <ConfirmationDialog
                    triggerLabel="Cancel session"
                    title="Cancel this tutoring session?"
                    description="The other participant will be notified. The appointment will be marked canceled."
                    confirmLabel="Cancel booking"
                    destructive
                    onConfirm={() => void cancel()}
                />
            )}
        </article>
    )
}
