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
                <a
                    className="text-link"
                    href={link.href}
                    target="_blank"
                    rel="noreferrer"
                >
                    Open meeting link
                </a>
            </p>
        )
    }

    return <p>{location}</p>
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
            <p>{formatCampusTime(booking.startsAt)} to {formatCampusTime(booking.endsAt)}</p>
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
