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

import App from '../src/app.js'
import { ApiError, createApiClient } from '../src/api/client.js'

const student = {
    id: '1', email: 'student@example.test', firstName: 'Avery', lastName: 'Reed',
    roles: ['student', 'tutor'], emailVerifiedAt: null,
}

/** Build an auth response with the same header used by the server. */
function tokenResponse(token: string, status = 204)
{
    return new Response(null, { status, headers: { Authorization: `Bearer ${token}` } })
}

/**
 * Render the real routes with a fake HTTP transport.
 * @param path Initial browser location.
 * @param send Fetch mock for the API client.
 */
function renderApp(path: string, send: typeof fetch)
{
    render(
        <MemoryRouter initialEntries={[path]}>
            <App api={createApiClient(send)} />
        </MemoryRouter>,
    )
}

afterEach(() =>
{
    cleanup()
    sessionStorage.clear()
})

describe('Phase 2 — Account and session flows', () =>
{
    test('submits student registration and shows the verification step', async () =>
    {
        const send = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 401 }))
            .mockResolvedValueOnce(tokenResponse('registered', 201))
            .mockResolvedValueOnce(Response.json(student))
        renderApp('/register?next=%2Fcourses%2F7', send)

        fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Avery' } })
        fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Reed' } })
        fireEvent.change(screen.getByLabelText('Campus email'), { target: { value: student.email } })
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'sample-password' } })
        fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

        expect(await screen.findByRole('heading', { name: 'Verify your email' })).toBeDefined()
        expect(send).toHaveBeenNthCalledWith(2, '/api/users', expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ email: student.email, password: 'sample-password', firstName: 'Avery', lastName: 'Reed' }),
        }))
        expect(screen.getByRole('link', { name: 'Browse courses' }).getAttribute('href')).toBe('/courses/7')
        expect(screen.getByRole('button', { name: 'Resend verification' })).toBeDefined()
    })

    test('restores the cookie session on reload and loads the current workspace roles', async () =>
    {
        const send = vi.fn<typeof fetch>().mockResolvedValueOnce(tokenResponse('restored'))
            .mockResolvedValueOnce(Response.json(student))
        renderApp('/tutor/calendar', send)

        expect(await screen.findByRole('heading', { name: 'Tutor calendar' })).toBeDefined()
        expect(screen.getByText('Hi, Avery')).toBeDefined()
        expect(screen.getByRole('link', { name: 'Account' }).querySelector('svg')).toBeDefined()
        expect(screen.getByRole('link', { name: 'My Sessions' })).toBeDefined()
        expect(send).toHaveBeenNthCalledWith(1, '/api/auth/refresh', { method: 'POST', credentials: 'same-origin' })
        expect(new Headers(send.mock.calls[1][1]?.headers).get('Authorization')).toBe('Bearer restored')
    })

    test('shares one refresh and retries each unauthorized request at most once', async () =>
    {
        const sentTokens: (string | null)[] = []
        let refreshes = 0
        const send = vi.fn<typeof fetch>(async (path, init) =>
        {
            if (path === '/api/auth/refresh')
            {
                refreshes += 1
                return tokenResponse(refreshes === 1 ? 'old' : 'new')
            }

            sentTokens.push(new Headers(init?.headers).get('Authorization'))
            if (path === '/api/users/me') return Response.json(student)
            return new Response(null, { status: 401 })
        })
        const api = createApiClient(send)
        await api.getProfile()

        // Send both requests with the same expired access token.
        const results = await Promise.allSettled([
            api.request('/bookings', { authenticated: true }),
            api.request('/catalog', { authenticated: true }),
        ])
        expect(results.every(result => result.status === 'rejected' && result.reason instanceof ApiError)).toBe(true)
        expect(refreshes).toBe(2)
        expect(sentTokens).toEqual(['Bearer old', 'Bearer old', 'Bearer old', 'Bearer new', 'Bearer new'])
    })

    test('returns a forbidden error without starting another refresh', async () =>
    {
        const send = vi.fn<typeof fetch>().mockResolvedValueOnce(tokenResponse('signed-in'))
            .mockResolvedValueOnce(Response.json(student))
            .mockResolvedValueOnce(Response.json({ error: 'Insufficient permissions.' }, { status: 403 }))
        const api = createApiClient(send)
        await api.getProfile()

        await expect(api.request('/bookings/admin', { authenticated: true }))
            .rejects.toMatchObject({ status: 403, message: 'Insufficient permissions.' })
        expect(send).toHaveBeenCalledTimes(3)
    })

    test('submits the email token and refreshes the signed-in profile after verification', async () =>
    {
        const send = vi.fn<typeof fetch>().mockResolvedValueOnce(tokenResponse('restored'))
            .mockResolvedValueOnce(Response.json(student))
            .mockResolvedValueOnce(new Response(null, { status: 204 }))
            .mockResolvedValueOnce(Response.json({ ...student, emailVerifiedAt: '2026-11-19T00:00:00Z' }))
        renderApp('/verify-email?token=sample-token&next=%2Fcourses%2F7', send)

        await screen.findByRole('button', { name: 'Resend verification' })
        fireEvent.click(screen.getByRole('button', { name: 'Verify email' }))

        expect(await screen.findByRole('heading', { name: 'Email verified' })).toBeDefined()
        expect(screen.getByRole('link', { name: 'Continue' }).getAttribute('href')).toBe('/courses/7')
        expect(send).toHaveBeenNthCalledWith(3, '/api/auth/verify-email', expect.objectContaining({
            method: 'POST', body: JSON.stringify({ token: 'sample-token' }),
        }))
        expect(send).toHaveBeenNthCalledWith(4, '/api/users/me', expect.anything())
    })

    test('offers sign-in and resend when a verification link expires', async () =>
    {
        const send = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 401 }))
            .mockResolvedValueOnce(new Response(null, { status: 400 }))
        renderApp('/verify-email?token=expired', send)

        fireEvent.click(screen.getByRole('button', { name: 'Verify email' }))
        expect(await screen.findByRole('heading', { name: 'Verification link expired' })).toBeDefined()
        const recovery = screen.getByRole('link', { name: 'Sign in to resend' })
        expect(recovery.getAttribute('href')).toMatch(/^\/sign-in\?next=%2Fverify-email/)
    })

    test('saves profile edits and updates the signed-in account header', async () =>
    {
        const updated = { ...student, firstName: 'Jordan', email: 'jordan@example.test' }
        const send = vi.fn<typeof fetch>().mockResolvedValueOnce(tokenResponse('restored'))
            .mockResolvedValueOnce(Response.json(student))
            .mockResolvedValueOnce(Response.json(updated))
        renderApp('/account', send)

        fireEvent.change(await screen.findByLabelText('First name'), { target: { value: updated.firstName } })
        fireEvent.change(screen.getByLabelText('Email', { exact: true }), { target: { value: updated.email } })
        fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'sample-password' } })
        fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))

        expect(await screen.findByText('Profile saved. Verify your new email address.')).toBeDefined()
        expect(screen.getByText('Hi, Jordan')).toBeDefined()
        expect(screen.getByLabelText('Current password')).toHaveProperty('value', '')
        expect(send).toHaveBeenNthCalledWith(3, '/api/users/me', expect.objectContaining({
            method: 'PATCH',
            body: JSON.stringify({
                firstName: updated.firstName, lastName: student.lastName, email: updated.email,
                currentPassword: 'sample-password', newPassword: '',
            }),
        }))
    })

    test('clears session state and returns to sign-in on logout', async () =>
    {
        const send = vi.fn<typeof fetch>().mockResolvedValueOnce(tokenResponse('restored'))
            .mockResolvedValueOnce(Response.json(student))
            .mockResolvedValueOnce(new Response(null, { status: 204 }))
        renderApp('/account', send)

        fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }))

        expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeDefined()
        expect(screen.queryByRole('link', { name: 'My Sessions' })).toBeNull()
        expect(send).toHaveBeenNthCalledWith(3, '/api/auth/logout', expect.objectContaining({ method: 'POST' }))
    })
})
