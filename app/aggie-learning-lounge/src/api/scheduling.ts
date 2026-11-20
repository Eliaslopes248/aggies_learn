import { readJson } from './catalog.js'
import type { ApiClient } from './client.js'

export type CalendarWindow = { startsAt: string; endsAt: string }
export type Slot = CalendarWindow & { availabilityBlockId: string; tutorId: string }
export type AvailabilityBlock = CalendarWindow & { id: string; tutorId: string; location: string }
export type Booking = CalendarWindow & {
    id: string
    courseId: string
    tutorId: string
    studentId: string
    location: string
    canceledAt: string | null
}
export type TutorCalendar = { blocks: AvailabilityBlock[]; bookings: Booking[] }

export const campusZone = 'America/New_York'
const campusDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: campusZone, year: 'numeric', month: '2-digit', day: '2-digit',
})
const campusDisplay = new Intl.DateTimeFormat('en-US', {
    timeZone: campusZone, weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
})
const campusClock = new Intl.DateTimeFormat('en-GB', {
    timeZone: campusZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})
const dateLabel = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric',
})

/**
 * Get the calendar day in Eastern time for an instant.
 * @param value UTC timestamp or Date.
 * @returns Calendar day in YYYY-MM-DD form.
 */
export function campusDay(value: string | Date = new Date()) : string
{
    const parts = campusDate.formatToParts(new Date(value))
    const fields = Object.fromEntries(parts.map(part => [part.type, part.value]))
    return `${fields.year}-${fields.month}-${fields.day}`
}

/**
 * Add days to a calendar date without changing its wall time.
 * @param day Calendar date.
 * @param count Days to add or subtract.
 * @returns Resulting calendar date.
 */
export function addDays(day: string, count: number) : string
{
    const date = new Date(`${day}T00:00:00Z`)
    date.setUTCDate(date.getUTCDate() + count)
    return date.toISOString().slice(0, 10)
}

/**
 * Format a plain calendar day for a day picker.
 * @param day Calendar date.
 * @returns Short weekday and date.
 */
export function formatDay(day: string) : string
{
    return dateLabel.format(new Date(`${day}T00:00:00Z`))
}

/**
 * Print an instant in campus time with its Eastern zone abbreviation.
 * @param value UTC timestamp.
 * @returns Date and time in campus time.
 */
export function formatCampusTime(value: string) : string
{
    return campusDisplay.format(new Date(value))
}

/**
 * Convert a stored instant to the local value used by datetime inputs.
 * @param value UTC timestamp.
 * @returns Eastern wall time for a datetime-local input.
 */
export function campusInput(value: string) : string
{
    return `${campusDay(value)}T${campusClock.format(new Date(value))}`
}

/**
 * Convert an Eastern wall time to UTC without guessing at DST transitions.
 * @param value Value from a datetime-local input.
 * @returns UTC timestamp for the API.
 */
export async function campusToUtc(value: string) : Promise<string>
{
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    {
        throw new Error('Enter a date and time in Eastern time.')
    }

    type TemporalApi = typeof import('@js-temporal/polyfill').Temporal
    const native = (globalThis as typeof globalThis & { Temporal?: TemporalApi }).Temporal
    const temporal = native ?? (await import('@js-temporal/polyfill')).Temporal

    try
    {
        return temporal.ZonedDateTime.from(`${value}[${campusZone}]`, {
            disambiguation: 'reject',
        }).toInstant().toString({ smallestUnit: 'millisecond' })
    }
    catch (error)
    {
        if (error instanceof RangeError)
        {
            throw new Error('Choose a valid Eastern time outside the daylight-saving clock change.', { cause: error })
        }

        throw error
    }
}

/**
 * Build UTC bounds for calendar days in campus time.
 * @param firstDay First included date.
 * @param days Number of days to include.
 * @returns Inclusive start and exclusive end.
 */
export async function calendarWindow(firstDay: string, days: number) : Promise<CalendarWindow>
{
    const [startsAt, endsAt] = await Promise.all([
        campusToUtc(`${firstDay}T00:00`),
        campusToUtc(`${addDays(firstDay, days)}T00:00`),
    ])
    return { startsAt, endsAt }
}

/**
 * Load course labels for a protected schedule, leaving archived IDs readable.
 * @param api Shared API client.
 * @param bookings Bookings whose course labels are needed.
 * @param signal Cancellation signal for course lookups.
 * @returns Labels keyed by course ID.
 */
export async function bookingCourseLabels(api: ApiClient, bookings: readonly Booking[], signal: AbortSignal) : Promise<Record<string, string>>
{
    const ids = [...new Set(bookings.map(booking => booking.courseId))]
    const results = await Promise.all(ids.map(async id =>
    {
        const course = await readJson<{ subjectCode: string; courseNumber: string; title: string }>(api, `/catalog/courses/${encodeURIComponent(id)}`, { signal })
            .catch(() => null)
        return [id, course ? `${course.subjectCode} ${course.courseNumber} — ${course.title}` : `Course ${id}`]
    }))

    return Object.fromEntries(results)
}
