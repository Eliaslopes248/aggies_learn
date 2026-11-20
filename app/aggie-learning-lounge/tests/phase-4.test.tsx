import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { createApiClient } from '../src/api/client.js'
import { calendarWindow, campusToUtc, formatCampusTime } from '../src/api/scheduling.js'
import App from '../src/app.js'
import type { AccountRole } from '../src/components/app.header.js'

const course = { id: '7', departmentId: '3', subjectCode: 'COMP', courseNumber: '101', title: 'Introduction to Computing' }
const tutor = { id: '4', firstName: 'Taylor', lastName: 'Reed' }
const slot = { availabilityBlockId: '5', tutorId: tutor.id, startsAt: '2026-11-19T16:00:00Z', endsAt: '2026-11-19T16:30:00Z' }
const booking = { ...slot, id: '6', studentId: '1', courseId: course.id, location: 'Private room 302', canceledAt: null }
const block = { ...slot, id: '5', location: 'Library' }

beforeEach(() =>
{
    // Fix only the clock. Testing Library's polling still uses real timers.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-19T14:00:00Z'))
})

afterEach(() =>
{
    cleanup()
    vi.useRealTimers()
})

/**
 * Mount a scheduling route with a signed-in profile and fake HTTP responses.
 * @param path Frontend page under test.
 * @param options Role, verification state, and optional response override.
 * @returns Request mock.
 */
function renderPage(path: string, options: {
    role?: AccountRole
    verified?: boolean
    route?: (url: URL, init?: RequestInit) => Response | undefined
} = {}) : ReturnType<typeof vi.fn<typeof fetch>>
{
    const { role = 'student', verified = true, route } = options
    const send = vi.fn<typeof fetch>(async (input, init) =>
    {
        const url = new URL(String(input), 'https://app.test')
        const override = route?.(url, init)
        if (override)
        {
            return override
        }

        switch (url.pathname)
        {
            case '/api/auth/refresh':
                return new Response(null, { status: 204, headers: { Authorization: 'Bearer active-token' } })
            case '/api/users/me':
                return Response.json({
                    ...tutor, id: role === 'tutor' ? tutor.id : '1', roles: [role],
                    emailVerifiedAt: verified ? '2026-11-18T00:00:00Z' : null,
                })
            case '/api/catalog/courses/7':
                return Response.json(course)
            case '/api/tutors':
                return Response.json([tutor])
            case '/api/availability/courses/7/slots':
                return Response.json([slot])
            case '/api/availability/tutors/4/calendar':
                return Response.json({ blocks: [block], bookings: [booking] })
            case '/api/bookings':
                return init?.method === 'POST' ? Response.json({ id: booking.id }, { status: 201 }) : Response.json([booking])
            case '/api/bookings/6':
                return Response.json(booking)
            default:
                throw new Error(`Unexpected request: ${url.pathname}`)
        }
    })

    render(
        <MemoryRouter initialEntries={[path]}>
            <App api={createApiClient(send)} />
        </MemoryRouter>,
    )
    return send
}

/** Select the visible time after its request finishes. */
async function selectSlot() : Promise<void>
{
    fireEvent.click(await screen.findByRole('button', { name: /11:00 AM EST · Taylor Reed/ }))
}

/**
 * Submit the positive action in a native dialog.
 * @param triggerLabel Accessible name of the opener.
 */
function confirmDialog(triggerLabel: string) : void
{
    const trigger = screen.getByRole('button', { name: triggerLabel })
    const dialog = trigger.nextElementSibling as HTMLDialogElement

    // jsdom lacks native dialog submission, so dispatch the same close result.
    Object.defineProperty(dialog, 'showModal', { value: () => { dialog.open = true } })
    fireEvent.click(trigger)
    dialog.returnValue = 'confirm'
    dialog.open = false
    fireEvent(dialog, new Event('close', { bubbles: true }))
}

describe('Phase 4 — Scheduling and sessions', () =>
{
    test('keeps the selected tutor, course, and Eastern time in the review', async () =>
    {
        const send = renderPage('/courses/7')
        await selectSlot()

        expect(screen.getByRole('heading', { name: 'Selected time' })).toBeDefined()
        expect(screen.getByText(/Introduction to Computing · Taylor Reed/)).toBeDefined()
        expect(screen.getByText(/^Thu, Nov 19, 11:00 AM EST to .*11:30 AM EST$/)).toBeDefined()
        expect(screen.getByRole('button', { name: 'Review booking' })).toBeDefined()
        expect(send.mock.calls.some(([, init]) => init?.method === 'POST' && init.body)).toBe(false)
    })

    test('offers verification before allowing an unverified student to book', async () =>
    {
        renderPage('/courses/7', { verified: false })
        await selectSlot()

        expect(screen.getByRole('link', { name: 'Verify your email' }).getAttribute('href'))
            .toBe('/verify-email?next=%2Fcourses%2F7')
        expect(screen.queryByRole('button', { name: 'Review booking' })).toBeNull()
    })

    test('refreshes the slots and clears the selection when a booking conflicts', async () =>
    {
        const send = renderPage('/courses/7', {
            route: (url, init) => url.pathname === '/api/bookings' && init?.method === 'POST'
                ? Response.json({ error: 'Conflict' }, { status: 409 })
                : undefined,
        })

        await selectSlot()
        confirmDialog('Review booking')

        expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'That time is no longer available. Choose another time.')
        expect(await screen.findByRole('button', { name: /11:00 AM EST · Taylor Reed/ })).toBeDefined()
        expect(screen.queryByRole('heading', { name: 'Selected time' })).toBeNull()
        expect(send.mock.calls.filter(([url]) => String(url).startsWith('/api/availability/courses/7/slots'))).toHaveLength(2)
    })

    test('requests confirmed location only after the booking succeeds', async () =>
    {
        const send = renderPage('/courses/7')
        await selectSlot()

        expect(screen.queryByText(booking.location)).toBeNull()
        expect(send.mock.calls.some(([url]) => url === '/api/bookings/6')).toBe(false)

        confirmDialog('Review booking')
        expect(await screen.findByRole('heading', { name: 'Booking confirmed' })).toBeDefined()
        expect(await screen.findByText(booking.location)).toBeDefined()
        expect(send).toHaveBeenCalledWith('/api/bookings', expect.objectContaining({
            method: 'POST', body: JSON.stringify({ courseId: '7', ...slot }),
        }))
        expect(screen.getByRole('link', { name: 'View My Sessions' }).getAttribute('href')).toBe('/sessions')
    })

    test('converts dates and durations across Eastern daylight-saving transitions', async () =>
    {
        expect(formatCampusTime('2026-03-08T06:30:00Z')).toContain('1:30 AM EST')
        expect(formatCampusTime('2026-03-08T07:30:00Z')).toContain('3:30 AM EDT')
        await expect(campusToUtc('2026-03-08T02:30')).rejects.toThrow('daylight-saving')
        await expect(campusToUtc('2026-11-01T01:30')).rejects.toThrow('daylight-saving')
        await expect(calendarWindow('2026-03-08', 1)).resolves.toEqual({
            startsAt: '2026-03-08T05:00:00.000Z', endsAt: '2026-03-09T04:00:00.000Z',
        })
    })

    test('saves and edits tutor availability using UTC timestamps', async () =>
    {
        const send = renderPage('/tutor/calendar', {
            role: 'tutor',
            route: (url, init) => url.pathname.startsWith('/api/availability/blocks') && init?.method
                ? new Response(null, { status: 204 })
                : undefined,
        })
        fireEvent.click(await screen.findByRole('button', { name: 'Add availability' }))
        fireEvent.change(screen.getByLabelText('Location or meeting link'), { target: { value: 'Library' } })
        fireEvent.click(screen.getByRole('button', { name: 'Save availability' }))
        expect(await screen.findByText('Availability saved.')).toBeDefined()
        expect(send).toHaveBeenCalledWith('/api/availability/blocks', expect.objectContaining({
            method: 'POST', body: JSON.stringify({
                startsAt: '2026-11-19T14:00:00.000Z', endsAt: '2026-11-19T15:00:00.000Z', location: 'Library',
            }),
        }))

        fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
        expect(screen.getByLabelText<HTMLInputElement>('Starts (Eastern time)').value).toBe('2026-11-19T11:00')
        fireEvent.change(screen.getByLabelText('Location or meeting link'), { target: { value: 'Lab' } })
        fireEvent.click(screen.getByRole('button', { name: 'Save availability' }))
        expect(await screen.findByText('Availability saved.')).toBeDefined()
        expect(send).toHaveBeenCalledWith('/api/availability/blocks/5', expect.objectContaining({
            method: 'PATCH', body: JSON.stringify({
                startsAt: '2026-11-19T16:00:00.000Z', endsAt: '2026-11-19T16:30:00.000Z', location: 'Lab',
            }),
        }))
    })

    test('keeps confirmed sessions after withdrawing an availability block', async () =>
    {
        let withdrawn = false
        const send = renderPage('/tutor/calendar', {
            role: 'tutor',
            route: (url, init) =>
            {
                if (url.pathname === '/api/availability/blocks/5' && init?.method === 'DELETE')
                {
                    withdrawn = true
                    return new Response(null, { status: 204 })
                }

                if (url.pathname === '/api/availability/tutors/4/calendar' && withdrawn)
                {
                    return Response.json({ blocks: [], bookings: [booking] })
                }

                return undefined
            },
        })

        await screen.findByRole('button', { name: 'Withdraw' })
        confirmDialog('Withdraw')
        expect(await screen.findByText(/Confirmed bookings are still scheduled/)).toBeDefined()
        expect(await screen.findByText(booking.location)).toBeDefined()
        expect(screen.queryByRole('button', { name: 'Withdraw' })).toBeNull()
        expect(send).toHaveBeenCalledWith('/api/availability/blocks/5', expect.objectContaining({ method: 'DELETE' }))
    })

    test('reloads the session list after confirmation of cancellation', async () =>
    {
        let canceled = false
        const send = renderPage('/sessions', {
            route: (url, init) =>
            {
                if (url.pathname === '/api/bookings/6' && init?.method === 'DELETE')
                {
                    canceled = true
                    return new Response(null, { status: 204 })
                }

                if (url.pathname === '/api/bookings' && canceled)
                {
                    return Response.json([{ ...booking, canceledAt: '2026-11-19T14:00:00Z' }])
                }

                return undefined
            },
        })

        await screen.findByRole('button', { name: 'Cancel session' })
        expect(send.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
        confirmDialog('Cancel session')

        expect(await screen.findByText('Session canceled.')).toBeDefined()
        expect(await screen.findByText('Canceled')).toBeDefined()
        expect(screen.queryByText(booking.location)).toBeNull()
        expect(send.mock.calls.filter(([url]) => String(url).startsWith('/api/bookings?'))).toHaveLength(2)
    })
})
