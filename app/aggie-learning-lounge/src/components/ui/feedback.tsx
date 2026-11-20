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

import type { ReactNode } from 'react'

/**
 * Render a hint, error, or success message beside the affected control.
 * @param props Message content and severity.
 */
export function FormMessage({ id, kind = 'hint', children }: {
    id?: string
    kind?: 'hint' | 'error' | 'success'
    children: ReactNode
}) : React.JSX.Element
{
    // Announce validation and completion feedback without making hints live.
    const role = kind === 'error' ? 'alert' : kind === 'success' ? 'status' : undefined

    return (
        <p
            id={id}
            className={`form-message form-message--${kind}`}
            role={role}
        >
            {children}
        </p>
    )
}

/**
 * Render a status label with text as well as color.
 * @param props Status text and tone.
 */
export function StatusLabel({ children, tone = 'neutral' }: {
    children: ReactNode
    tone?: 'neutral' | 'positive' | 'attention' | 'negative'
}) : React.JSX.Element
{
    return <span className={`status-label status-label--${tone}`}>{children}</span>
}

/**
 * Announce loading and reserve room for the resulting rows.
 * @param props Accessible loading message.
 */
export function LoadingState({ label = 'Loading…' }: { label?: string }) : React.JSX.Element
{
    return (
        <div className="loading-state" role="status">
            <span className="visually-hidden">{label}</span>

            {/* Decorative rows reserve space without repeating the loading message. */}
            <div className="loading-row" aria-hidden="true" />
            <div className="loading-row" aria-hidden="true" />
        </div>
    )
}

/**
 * Explain an empty view and offer a recovery action when available.
 * @param props Heading, description, and optional action.
 */
export function EmptyState({ title, children, action }: {
    title: string
    children: ReactNode
    action?: ReactNode
}) : React.JSX.Element
{
    return (
        <div className="empty-state">
            <h2>{title}</h2>
            <p>{children}</p>
            {action && <div className="empty-action">{action}</div>}
        </div>
    )
}
