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

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, test, vi } from 'vitest'

import App from '../src/app.js'
import { ConfirmationDialog } from '../src/components/ui/confirmation.dialog.js'
import { Button, Field } from '../src/components/ui/controls.js'
import { EmptyState, LoadingState, StatusLabel } from '../src/components/ui/feedback.js'

afterEach(cleanup)

describe('Phase 1 — App shell and shared components', () =>
{
    test('renders the public Courses entry and marks it current in navigation', async () =>
    {
        render(
            <MemoryRouter initialEntries={['/']}>
                <App />
            </MemoryRouter>,
        )

        expect(await screen.findByRole('heading', { name: 'Find tutoring for your course.' })).toBeDefined()
        expect(screen.getByRole('link', { name: 'Courses' }).getAttribute('aria-current')).toBe('page')
        expect(screen.queryByRole('link', { name: 'Tutor' })).toBeNull()
    })

    test('provides a route back to Courses from an unknown page', async () =>
    {
        render(
            <MemoryRouter initialEntries={['/missing']}>
                <App />
            </MemoryRouter>,
        )

        expect(screen.getByRole('heading', { name: 'Page not found' })).toBeDefined()
        fireEvent.click(screen.getByRole('link', { name: 'Browse courses' }))

        expect(await screen.findByRole('heading', { name: 'Find tutoring for your course.' })).toBeDefined()
    })

    test('shows both student and tutor destinations for an account with both roles', () =>
    {
        render(
            <MemoryRouter initialEntries={['/courses']}>
                <App roles={['student', 'tutor']} />
            </MemoryRouter>,
        )

        const nav = within(screen.getByRole('navigation', { name: 'Main navigation' }))
        expect(nav.getByRole('link', { name: 'My Sessions' }).getAttribute('href')).toBe('/sessions')
        expect(nav.getByRole('link', { name: 'Tutor' }).getAttribute('href')).toBe('/tutor/calendar')
        expect(screen.getByRole('link', { name: 'Account' }).getAttribute('href')).toBe('/account')
        expect(nav.queryByRole('link', { name: 'Admin' })).toBeNull()
    })

    test('blocks a tutor without admin access from the admin workspace', () =>
    {
        render(<MemoryRouter initialEntries={['/admin/catalog']}><App roles={['tutor']} /></MemoryRouter>)

        expect(screen.getByRole('heading', { name: 'Access restricted' })).toBeDefined()
    })

    test('uses a native menu button and restores focus when Escape closes the navigation', () =>
    {
        render(<MemoryRouter initialEntries={['/courses']}><App /></MemoryRouter>)

        const menu = screen.getByRole('button', { name: 'Menu' })
        const navigation = screen.getByRole('navigation', { name: 'Main navigation' })

        expect(menu.tagName).toBe('BUTTON')
        expect(menu.getAttribute('aria-controls')).toBe(navigation.id)
        expect(menu.getAttribute('aria-expanded')).toBe('false')
        fireEvent.click(menu)
        expect(menu.getAttribute('aria-expanded')).toBe('true')

        // Escape returns focus to the control that opened the menu.
        const link = within(navigation).getByRole('link', { name: 'Courses' })
        link.focus()
        fireEvent.keyDown(link, { key: 'Escape' })

        expect(menu.getAttribute('aria-expanded')).toBe('false')
        expect(document.activeElement).toBe(menu)
    })

    test('associates a visible label, hint, and error with the input', () =>
    {
        render(<Field label="Campus email" type="email" hint="Use your campus address." error="Enter a valid email." />)

        const input = screen.getByRole('textbox', { name: 'Campus email' })
        const error = screen.getByRole('alert')
        expect(input.getAttribute('aria-invalid')).toBe('true')
        expect(input.getAttribute('aria-describedby')?.split(' ')).toContain(error.id)
        expect(error.textContent).toBe('Enter a valid email.')
    })

    test('exposes pending, loading, and empty states without relying on color', () =>
    {
        render(
            <>
                <Button pending>Save</Button>
                <LoadingState label="Loading courses" />
                <StatusLabel tone="positive">Confirmed</StatusLabel>
                <EmptyState title="No courses found">Try a different search.</EmptyState>
            </>,
        )

        const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Save' })
        expect(button.disabled).toBe(true)
        expect(button.getAttribute('aria-busy')).toBe('true')
        expect(screen.getByRole('status').textContent).toBe('Loading courses')
        expect(screen.getByText('Confirmed')).toBeDefined()
        expect(screen.getByRole('heading', { name: 'No courses found' })).toBeDefined()
    })

    test('opens a labeled native dialog and fires the callback only on confirmation', () =>
    {
        const confirm = vi.fn()
        const { container } = render(
            <ConfirmationDialog
                triggerLabel="Cancel session"
                title="Cancel this session?"
                description="The other participant will be notified."
                confirmLabel="Cancel booking"
                destructive
                onConfirm={confirm}
            />,
        )
        const dialog = container.querySelector('dialog')!
        const showModal = vi.fn(() => { dialog.open = true })
        // jsdom does not implement native modal focus or submission.
        Object.defineProperty(dialog, 'showModal', { value: showModal })
        fireEvent.click(screen.getByRole('button', { name: 'Cancel session' }))

        expect(showModal).toHaveBeenCalledOnce()
        expect(screen.getByRole('dialog', { name: 'Cancel this session?' })).toBe(dialog)
        expect(dialog.querySelector('form')?.getAttribute('method')).toBe('dialog')

        dialog.returnValue = 'confirm'
        fireEvent(dialog, new Event('close', { bubbles: true }))
        fireEvent(dialog, new Event('close', { bubbles: true }))

        expect(confirm).toHaveBeenCalledOnce()
        expect(dialog.returnValue).toBe('')
    })
})
