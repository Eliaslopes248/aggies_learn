import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { createApiClient } from '../src/api/client.js'
import App from '../src/app.js'
import type { AccountRole } from '../src/components/app.header.js'

const booking = {
    id: '14',
    courseId: '7',
    studentId: '2',
    tutorId: '3',
    startsAt: '2026-03-08T14:00:00Z',
    endsAt: '2026-03-08T14:30:00Z',
    canceledAt: null,
    location: 'Library',
}

/**
 * Render the real admin route with a fake booking API.
 * @param respond Response to the current booking query.
 * @param roles Roles supplied by the test session.
 * @returns Mock fetch for verifying requests.
 */
function renderSupport(
    respond: (query: URLSearchParams) => Response | Promise<Response>,
    roles: AccountRole[] = ['admin'],
) : ReturnType<typeof vi.fn<typeof fetch>>
{
    const send = vi.fn<typeof fetch>(async input =>
    {
        const url = new URL(String(input), 'https://app.test')
        switch (url.pathname)
        {
            case '/api/auth/refresh':
                return new Response(null, { status: 204, headers: { Authorization: 'Bearer admin-token' } })
            case '/api/bookings/admin':
                return respond(url.searchParams)
            case '/api/catalog/courses/7':
                return Response.json({ subjectCode: 'COMP', courseNumber: '101', title: 'Introduction' })
            default:
                throw new Error(`Unexpected request: ${url.pathname}`)
        }
    })

    render(
        <MemoryRouter initialEntries={['/admin/bookings']}>
            <App roles={roles} api={createApiClient(send)} />
        </MemoryRouter>,
    )

    return send
}

afterEach(cleanup)

describe('Phase 5 — Admin support and pilot readiness', () =>
{
    test('passes trimmed IDs, Eastern UTC bounds, cancellation status, and first-page limits to the API', async () =>
    {
        const queries: URLSearchParams[] = []
        renderSupport(query =>
        {
            queries.push(query)
            return Response.json([])
        })
        await screen.findByRole('heading', { name: 'No matching bookings' })

        fireEvent.change(screen.getByLabelText('Course ID'), { target: { value: ' 7 ' } })
        fireEvent.change(screen.getByLabelText('Tutor account ID'), { target: { value: '3' } })
        fireEvent.change(screen.getByLabelText('Participant account ID'), { target: { value: '9007199254740993' } })
        fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-03-08' } })
        fireEvent.change(screen.getByLabelText('Through date'), { target: { value: '2026-03-08' } })
        fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'canceled' } })
        fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))

        await waitFor(() => expect(queries).toHaveLength(2))
        expect(Object.fromEntries(queries[1])).toEqual({
            limit: '25', offset: '0', courseId: '7', tutorId: '3', participantId: '9007199254740993',
            startsAt: '2026-03-08T05:00:00.000Z', endsAt: '2026-03-09T04:00:00.000Z',
            includeCanceled: 'true', canceledOnly: 'true',
        })
    })

    test('pages by 25 records and refuses invalid IDs without sending a request', async () =>
    {
        const queries: URLSearchParams[] = []
        const rows = Array.from({ length: 25 }, (_, index) => ({ ...booking, id: String(index + 1) }))
        renderSupport(query =>
        {
            queries.push(query)
            return Response.json(query.get('offset') === '0' ? rows : [])
        })
        fireEvent.click(await screen.findByRole('button', { name: 'Next page' }))

        await screen.findByRole('heading', { name: 'No matching bookings' })
        expect(queries.map(query => [query.get('limit'), query.get('offset')])).toEqual([
            ['25', '0'], ['25', '25'],
        ])

        fireEvent.change(screen.getByLabelText('Course ID'), { target: { value: '9223372036854775808' } })
        fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))
        expect(screen.getByRole('alert').textContent).toBe('Course ID must be a valid positive ID.')
        expect(queries).toHaveLength(2)
    })

    test('denies the route to non-admins before making a booking API request', async () =>
    {
        const send = renderSupport(() => Response.json([]), ['tutor'])

        expect(await screen.findByRole('heading', { name: 'Access restricted' })).toBeDefined()
        expect(send).not.toHaveBeenCalled()
    })

    test('shows a permission state when a previously authorized account receives a 403', async () =>
    {
        renderSupport(() => Response.json({ error: 'Insufficient permissions.' }, { status: 403 }))

        expect(await screen.findByRole('heading', { name: 'Access restricted' })).toBeDefined()
        expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    })

    test('ignores stale booking results that arrive after newer filter results', async () =>
    {
        const old = Promise.withResolvers<Response>()
        const queryStarted = vi.fn()
        renderSupport(query =>
        {
            queryStarted(query.get('courseId'))
            if (query.get('courseId') === '8')
            {
                return old.promise
            }

            return Response.json(query.get('courseId') === '7' ? [booking] : [])
        })
        await screen.findByRole('heading', { name: 'No matching bookings' })

        const field = screen.getByLabelText('Course ID')
        const apply = screen.getByRole('button', { name: 'Apply filters' })
        fireEvent.change(field, { target: { value: '8' } })
        fireEvent.click(apply)
        await waitFor(() => expect(queryStarted).toHaveBeenCalledWith('8'))
        expect(screen.getByRole('region', { name: 'Results' }).getAttribute('aria-busy')).toBe('true')

        fireEvent.change(field, { target: { value: '7' } })
        fireEvent.click(apply)
        const table = await screen.findByRole('table', { name: 'Booking search results' })
        expect(within(table).getByRole('rowheader', { name: '#14' })).toBeDefined()

        await act(async () =>
        {
            // Even a transport that ignores AbortSignal must not replace the newer result.
            old.resolve(Response.json([{ ...booking, id: '99' }]))
        })

        expect(within(table).getByRole('rowheader', { name: '#14' })).toBeDefined()
        expect(screen.queryByRole('rowheader', { name: '#99' })).toBeNull()
    })

    test('offers a retry after a request failure and shows a distinct empty state on success', async () =>
    {
        let attempts = 0
        renderSupport(() =>
        {
            attempts += 1
            return attempts === 1
                ? Response.json({ error: 'Unable to load bookings.' }, { status: 503 })
                : Response.json([])
        })

        expect((await screen.findByRole('alert')).textContent).toBe('Unable to load bookings.')
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
        expect(await screen.findByRole('heading', { name: 'No matching bookings' })).toBeDefined()
        expect(attempts).toBe(2)
    })
})
