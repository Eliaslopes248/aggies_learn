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

import { useId, useRef, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router'

import { authLink, returnPath } from '../api/auth.navigation.js'

export type AccountRole = 'student' | 'tutor' | 'admin'

/**
 * Show the shared navigation and workspaces available to the account.
 * @param props Roles and first name of the current account.
 */
export function AppHeader({ roles, firstName }: {
    roles: readonly AccountRole[]
    firstName: string | undefined
}) : React.JSX.Element
{
    const [isOpen, setIsOpen] = useState(false)
    const menuButton = useRef<HTMLButtonElement>(null)
    const navId = useId()
    const { pathname, search } = useLocation()

    // Leave verification tokens out of the sign-in return link.
    const next = pathname === '/verify-email'
        ? '/verify-email'
        : returnPath(pathname + search)
    const signIn = authLink('/sign-in', next)

    // Show every workspace the account can access.
    const links = [{ to: '/courses', label: 'Courses' }]

    if (roles.length)
    {
        links.push({ to: '/sessions', label: 'My Sessions' })
    }

    if (roles.includes('tutor'))
    {
        links.push({ to: '/tutor/calendar', label: 'Tutor' })
    }

    if (roles.includes('admin'))
    {
        links.push({ to: '/admin/catalog', label: 'Admin' })
    }

    return (
        <header className="app-header">
            <div
                className="header-inner page-width"
                onKeyDown={event =>
                {
                    if (event.key === 'Escape' && isOpen)
                    {
                        event.stopPropagation()
                        setIsOpen(false)
                        menuButton.current?.focus()
                    }
                }}
            >
                <Link to="/courses" className="wordmark" onClick={() => setIsOpen(false)}>
                    <span>Aggie Learning Lounge</span>
                </Link>

                {/* The mobile toggle controls the same links shown on desktop. */}
                <button
                    ref={menuButton}
                    type="button"
                    className="menu-toggle"
                    aria-controls={navId}
                    aria-expanded={isOpen}
                    onClick={() => setIsOpen(open => !open)}
                >
                    Menu <span className="menu-indicator" aria-hidden="true" />
                </button>

                <nav
                    id={navId}
                    className="workspace-nav"
                    aria-label="Main navigation"
                    data-open={isOpen}
                >
                    <ul>
                        {links.map(({ to, label }) => (
                            <li key={to}>
                                <NavLink to={to} onClick={() => setIsOpen(false)}>{label}</NavLink>
                            </li>
                        ))}

                        {!roles.length && (
                            <li>
                                <NavLink
                                    className="sign-in-link"
                                    to={signIn}
                                    onClick={() => setIsOpen(false)}
                                >
                                    Sign in
                                </NavLink>
                            </li>
                        )}
                    </ul>
                </nav>

                {roles.length > 0 && (
                    <div className="account-actions">
                        {firstName && <span className="account-greeting">Hi, {firstName}</span>}

                        <NavLink
                            className="account-link"
                            to="/account"
                            aria-label="Account"
                            onClick={() => setIsOpen(false)}
                        >
                            <svg
                                aria-hidden="true"
                                width="24"
                                height="24"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.75"
                                strokeLinecap="round"
                            >
                                <circle cx="12" cy="8" r="3" />
                                <path d="M5.5 19c.3-3.2 3-5 6.5-5s6.2 1.8 6.5 5" />
                            </svg>
                        </NavLink>
                    </div>
                )}
            </div>
        </header>
    )
}
