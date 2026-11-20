import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { createApiClient } from '../src/api/client.js'
import App from '../src/app.js'
import type { AccountRole } from '../src/components/app.header.js'

const colleges = [
    { id: '1', name: 'College of Engineering', archivedAt: null },
    { id: '2', name: 'College of Science', archivedAt: null },
]
const department = { id: '3', collegeId: '1', name: 'Computer Science', archivedAt: null }
const course = { id: '7', departmentId: '3', subjectCode: 'COMP', courseNumber: '101', title: 'Introduction to Computing', archivedAt: null }
const assignment = { tutorId: '4', courseId: '7' }

/**
 * Mount one workspace with fake backend responses.
 * @param path Initial frontend URL.
 * @param roles Roles exposed to the shell.
 * @param route Optional response override for this test.
 * @returns Fetch mock so the test can verify calls.
 */
function renderPage(
    path: string,
    roles: AccountRole[],
    route?: (url: URL, init?: RequestInit) => Response | undefined,
) : ReturnType<typeof vi.fn<typeof fetch>>
{
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
                return new Response(null, { status: 204, headers: { Authorization: 'Bearer test-token' } })
            case '/api/catalog/colleges':
                return Response.json(colleges)
            case '/api/catalog/colleges/1/departments':
                return Response.json([department])
            case '/api/catalog/courses':
                return Response.json([course])
            case '/api/catalog/courses/7':
                return Response.json(course)
            case '/api/tutors':
                return init?.method === 'POST'
                    ? Response.json({ id: '4', firstName: 'Avery', lastName: 'Reed' })
                    : Response.json([])
            case '/api/tutors/me/courses':
            case '/api/tutors/4/courses':
                return Response.json([assignment])
            default:
                throw new Error(`Unexpected request: ${url.pathname}`)
        }
    })

    render(
        <MemoryRouter initialEntries={[path]}>
            <App roles={roles} api={createApiClient(send)} />
        </MemoryRouter>,
    )

    return send
}

afterEach(cleanup)

describe('Phase 3 — Discovery, catalog, and tutor onboarding', () =>
{
    test('initializes search and hierarchy filters from the URL and shows another college from the API', async () =>
    {
        const send = renderPage('/courses?search=COMP&collegeId=1&departmentId=3', [])

        expect((screen.getByRole<HTMLInputElement>('searchbox', { name: 'Search courses' })).value).toBe('COMP')
        expect(await screen.findByRole('link', { name: /Introduction to Computing/ })).toBeDefined()
        fireEvent.click(screen.getByText('Filters (active)'))

        expect(await screen.findByRole('option', { name: 'College of Science' })).toBeDefined()
        expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'College' }).value).toBe('1')
        expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Department' }).value).toBe('3')
        expect(send.mock.calls.some(([path]) => String(path).includes('search=COMP&collegeId=1&departmentId=3'))).toBe(true)

        fireEvent.change(screen.getByRole('combobox', { name: 'College' }), { target: { value: '2' } })
        expect((await screen.findByRole('link', { name: /Introduction to Computing/ })).getAttribute('href'))
            .toBe('/courses/7?search=COMP&collegeId=2')
    })

    test('shows no matching courses and no assigned tutors as separate states', async () =>
    {
        renderPage('/courses?search=missing', [], url => url.pathname === '/api/catalog/courses' ? Response.json([]) : undefined)

        expect(await screen.findByRole('heading', { name: 'No courses found' })).toBeDefined()
        cleanup()
        renderPage('/courses/7', ['student'])

        expect(await screen.findByRole('heading', { name: 'No tutors available' })).toBeDefined()
    })

    test('asks a guest to sign in and preserves their selected course', async () =>
    {
        const send = renderPage('/courses/7?search=COMP', [])
        const prompt = await screen.findByRole('heading', { name: 'Sign in to find tutors' })
        const signIn = prompt.parentElement?.querySelector('a')

        expect(signIn?.getAttribute('href')).toBe('/sign-in?next=%2Fcourses%2F7%3Fsearch%3DCOMP')
        expect(send.mock.calls.some(([path]) => String(path).startsWith('/api/tutors'))).toBe(false)
    })

    test('previews course import and preserves input when the server reports a row error', async () =>
    {
        const send = renderPage('/admin/catalog', ['admin'], url =>
            url.pathname === '/api/catalog/courses/import'
                ? Response.json({ error: 'Row 1: Department not found.' }, { status: 404 })
                : undefined,
        )
        fireEvent.click(await screen.findByRole('button', { name: 'Courses' }))

        const input = screen.getByLabelText<HTMLTextAreaElement>('Course records (JSON)')
        const raw = JSON.stringify([{ departmentId: '9', subjectCode: 'COMP', courseNumber: '201', title: 'Data Structures' }])
        fireEvent.change(input, { target: { value: raw } })
        fireEvent.click(screen.getByRole('button', { name: 'Preview import' }))

        expect(screen.getByRole('heading', { name: '1 course ready for review' })).toBeDefined()
        expect(send.mock.calls.some(([path]) => path === '/api/catalog/courses/import')).toBe(false)

        fireEvent.click(screen.getByRole('button', { name: 'Import reviewed courses' }))
        expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Row 1: Department not found.')
        expect(input.value).toBe(raw)
    })

    test('archives a catalog entry only after confirmation', async () =>
    {
        const send = renderPage('/admin/catalog', ['admin'], (url, init) =>
            url.pathname === '/api/catalog/colleges/1' && init?.method === 'DELETE'
                ? new Response(null, { status: 204 })
                : undefined,
        )

        await screen.findByRole('heading', { name: 'College of Engineering' })
        const record = screen.getByRole('heading', { name: 'College of Engineering' }).closest('li')!
        const dialog = record.querySelector('dialog')!
        // jsdom lacks native dialog events. Simulate dismissal and confirmation.
        Object.defineProperty(dialog, 'showModal', { value: () => { dialog.open = true } })
        fireEvent.click(record.querySelector('button:last-of-type')!)
        dialog.returnValue = 'cancel'
        fireEvent(dialog, new Event('close', { bubbles: true }))
        expect(send.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)

        dialog.returnValue = 'confirm'
        fireEvent(dialog, new Event('close', { bubbles: true }))
        expect(await screen.findByText('Catalog entry archived.')).toBeDefined()
        expect(send).toHaveBeenCalledWith('/api/catalog/colleges/1', expect.objectContaining({ method: 'DELETE' }))
    })

    test('provisions an existing account with selected courses and loads its assignments', async () =>
    {
        const send = renderPage('/admin/tutors', ['admin'])

        const id = await screen.findByLabelText('Existing account ID')
        fireEvent.change(id, { target: { value: '4' } })
        fireEvent.click(await screen.findByRole('button', { name: /Select COMP 101/ }))
        fireEvent.click(screen.getByRole('button', { name: 'Save tutor access' }))

        expect(await screen.findByRole('heading', { name: 'Avery Reed' })).toBeDefined()
        expect(await screen.findByRole('button', { name: 'Deactivate' })).toBeDefined()
        expect(send).toHaveBeenCalledWith('/api/tutors', expect.objectContaining({
            method: 'POST', body: JSON.stringify({ accountId: '4', courseIds: ['7'] }),
        }))
    })

    test('shows active course assignments in the tutor workspace', async () =>
    {
        const send = renderPage('/tutor/courses', ['tutor'])

        expect(await screen.findByText('COMP 101 — Introduction to Computing')).toBeDefined()
        expect(send).toHaveBeenCalledWith('/api/tutors/me/courses', expect.objectContaining({
            headers: expect.any(Headers),
        }))
    })
})
