import { useCallback, useState } from 'react'

import { readJson, requestMessage } from '../api/catalog.js'
import type { ApiClient } from '../api/client.js'
import { addDays, bookingCourseLabels, calendarWindow, campusDay, formatDay, type Booking } from '../api/scheduling.js'
import { BookingRecord } from '../components/schedule.records.js'
import { Button } from '../components/ui/controls.js'
import { EmptyState, FormMessage, LoadingState } from '../components/ui/feedback.js'
import { useResource } from '../hooks/use.resource.js'

const daysPerPeriod = 28
const pageSize = 25

/**
 * List the signed-in user's sessions and let them cancel upcoming bookings.
 * @param props Shared API client and signed-in account ID.
 * @returns Upcoming and past sessions workspace.
 */
export default function SessionsPage({ api, actorId }: { api: ApiClient; actorId?: string }) : React.JSX.Element
{
    const [now] = useState(() => new Date())
    const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming')
    const [period, setPeriod] = useState(0)
    const [offset, setOffset] = useState(0)
    const [message, setMessage] = useState('')
    const firstDay = addDays(campusDay(now), tab === 'upcoming' ? period * daysPerPeriod : -(period + 1) * daysPerPeriod)
    const load = useCallback(async (signal: AbortSignal) =>
    {
        const window = await calendarWindow(firstDay, daysPerPeriod)

        if (period === 0)
        {
            if (tab === 'upcoming')
            {
                window.startsAt = now.toISOString()
            }
            else
            {
                window.endsAt = now.toISOString()
            }
        }

        const query = new URLSearchParams({
            ...window, limit: String(pageSize), offset: String(offset), includeCanceled: 'true',
        })
        const rows = await readJson<Booking[]>(api, `/bookings?${query}`, { authenticated: true, signal })
        const bookings = rows.filter(booking =>
            Date.parse(booking.startsAt) >= Date.parse(window.startsAt) && Date.parse(booking.startsAt) < Date.parse(window.endsAt))
        const labels = await bookingCourseLabels(api, bookings, signal)

        return { bookings, labels, hasNextPage: rows.length === pageSize }
    }, [api, firstDay, now, offset, period, tab])
    const sessions = useResource(load)

    /**
     * Change the visible group and reset its period and pagination.
     * @param next Next session group.
     */
    function selectTab(next: 'upcoming' | 'past') : void
    {
        setTab(next)
        setPeriod(0)
        setOffset(0)
        setMessage('')
    }

    /**
     * Cancel a selected booking and reload the current list.
     * @param id Booking selected by the user.
     */
    async function cancelBooking(id: string) : Promise<void>
    {
        setMessage('')

        try
        {
            await api.request(`/bookings/${id}`, { method: 'DELETE', authenticated: true })
            setMessage('Session canceled.')
            sessions.reload()
        }
        catch (error)
        {
            throw new Error(requestMessage(error), { cause: error })
        }
    }

    return (
        <section className="catalog-section page-width">
            <h1 className="workspace-heading">My Sessions</h1>
            <div className="record-actions" aria-label="Session groups">
                <Button
                    variant={tab === 'upcoming' ? 'primary' : 'secondary'}
                    aria-pressed={tab === 'upcoming'}
                    onClick={() => selectTab('upcoming')}
                >
                    Upcoming
                </Button>
                <Button
                    variant={tab === 'past' ? 'primary' : 'secondary'}
                    aria-pressed={tab === 'past'}
                    onClick={() => selectTab('past')}
                >
                    Past
                </Button>
            </div>

            <div className="schedule-panel">
                <h2>{tab === 'upcoming' ? 'Upcoming sessions' : 'Past sessions'}</h2>
                <p>
                    {formatDay(firstDay)} through {formatDay(addDays(firstDay, daysPerPeriod - 1))} · Eastern time
                </p>

                {message && <FormMessage kind="success">{message}</FormMessage>}
                {sessions.pending && <LoadingState label="Loading sessions" />}
                {sessions.error && (
                    <div>
                        <FormMessage kind="error">{sessions.error}</FormMessage>
                        <Button variant="secondary" onClick={sessions.reload}>Try again</Button>
                    </div>
                )}
                {sessions.data?.bookings.length === 0 && (
                    <EmptyState title="No sessions in this period">
                        Choose another period to check for sessions.
                    </EmptyState>
                )}
                <ul className="record-list">
                    {sessions.data?.bookings.map(booking => (
                        <li key={booking.id}>
                            <BookingRecord
                                booking={booking}
                                actorId={actorId}
                                title={sessions.data?.labels[booking.courseId] ?? `Course ${booking.courseId}`}
                                onCancel={() => cancelBooking(booking.id)}
                            />
                        </li>
                    ))}
                </ul>

                <div className="record-actions">
                    {period > 0 && (
                        <Button
                            variant="secondary"
                            onClick={() =>
                            {
                                setPeriod(period - 1)
                                setOffset(0)
                            }}
                        >
                            Back one period
                        </Button>
                    )}
                    <Button
                        variant="secondary"
                        onClick={() =>
                        {
                            setPeriod(period + 1)
                            setOffset(0)
                        }}
                    >
                        {tab === 'past' ? 'Older sessions' : 'Later sessions'}
                    </Button>
                    {offset > 0 && (
                        <Button
                            variant="secondary"
                            onClick={() => setOffset(Math.max(offset - pageSize, 0))}
                        >
                            Previous page
                        </Button>
                    )}
                    {sessions.data?.hasNextPage && (
                        <Button variant="secondary" onClick={() => setOffset(offset + pageSize)}>
                            Next page
                        </Button>
                    )}
                </div>
            </div>
        </section>
    )
}
