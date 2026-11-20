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

    test('searches the tutor directory, reveals the ID, and saves a name through the editor', async () =>
    {
        const tutor = {
            id: '42', firstName: 'Avery', lastName: 'Reed', email: 'avery@example.test',
            createdAt: '2026-11-01T17:00:00Z', emailVerifiedAt: null,
        }
        const send = renderPage('/admin/tutors', ['admin'], (url, init) =>
        {
            if (url.pathname === '/api/tutors/admin')
            {
                return Response.json(url.searchParams.get('search') === 'Avery Re' ? [tutor] : [])
            }
            if (url.pathname === '/api/tutors/42' && init?.method === 'PATCH')
            {
                return new Response(null, { status: 204 })
            }
            if (url.pathname === '/api/tutors/42/courses')
            {
                return Response.json([{ tutorId: '42', courseId: '7' }])
            }
        })

        fireEvent.click(await screen.findByRole('button', { name: 'Tutor directory' }))
        fireEvent.change(screen.getByRole('searchbox', { name: 'Search by first or last name' }), {
            target: { value: 'Avery Re' },
        })
        fireEvent.click(screen.getByRole('button', { name: 'Search' }))

        const reveal = await screen.findByRole('button', { name: 'Show tutor ID for Avery Reed' })
        expect(screen.getByRole('table', { name: 'Tutor search results' })).toBeDefined()
        expect(screen.getByText(tutor.email)).toBeDefined()
        expect(screen.getByText('Unverified')).toBeDefined()
        expect(screen.queryByText('42')).toBeNull()
        fireEvent.click(reveal)
        expect(screen.getByText('42')).toBeDefined()
        fireEvent.click(screen.getByRole('button', { name: 'Hide tutor ID for Avery Reed' }))
        expect(screen.queryByText('42')).toBeNull()

        fireEvent.click(screen.getByRole('button', { name: 'Edit Avery Reed' }))
        expect(screen.getByRole('heading', { name: 'Avery Reed' })).toBe(document.activeElement)
        expect(await screen.findByRole('button', { name: 'Deactivate' })).toBeDefined()
        fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Brooks' } })
        fireEvent.click(screen.getByRole('button', { name: 'Save tutor name' }))

        expect(await screen.findByText('Tutor name saved.')).toBeDefined()
        expect(screen.getByRole('heading', { name: 'Avery Brooks' })).toBeDefined()
        expect(send).toHaveBeenCalledWith('/api/tutors/42', expect.objectContaining({
            method: 'PATCH', body: JSON.stringify({ firstName: 'Avery', lastName: 'Brooks' }),
        }))
    })

    test('searches student accounts, reveals an ID, and refreshes results after a name edit', async () =>
    {
        const student = {
            id: '42', firstName: 'Avery', lastName: 'Reed', email: 'avery@example.test',
            createdAt: '2026-11-01T17:00:00Z', emailVerifiedAt: null,
        }
        const send = renderPage('/admin/students', ['admin'], (url, init) =>
        {
            if (url.pathname === '/api/users/students')
            {
                return Response.json(url.searchParams.get('search') === 'Avery' ? [student] : [])
            }
            if (url.pathname === '/api/users/students/42' && init?.method === 'PATCH')
            {
                student.lastName = 'Brooks'
                return new Response(null, { status: 204 })
            }
        })

        fireEvent.change(await screen.findByRole('searchbox', { name: 'Search by first or last name' }), {
            target: { value: 'Avery' },
        })
        fireEvent.click(screen.getByRole('button', { name: 'Search' }))
        const reveal = await screen.findByRole('button', { name: 'Show student ID for Avery Reed' })
        expect(screen.getByText(student.email)).toBeDefined()
        expect(screen.queryByText('42')).toBeNull()
        fireEvent.click(reveal)
        expect(screen.getByText('42')).toBeDefined()

        fireEvent.click(screen.getByRole('button', { name: 'Edit Avery Reed' }))
        fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Brooks' } })
        fireEvent.click(screen.getByRole('button', { name: 'Save student name' }))
        expect(await screen.findByRole('button', { name: 'Edit Avery Brooks' })).toBeDefined()
        expect(screen.queryByText('42')).toBeNull()
        expect(send).toHaveBeenCalledWith('/api/users/students/42', expect.objectContaining({
            method: 'PATCH', body: JSON.stringify({ firstName: 'Avery', lastName: 'Brooks' }),
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
