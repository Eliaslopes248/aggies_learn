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

import { useId, type ButtonHTMLAttributes, type InputHTMLAttributes } from 'react'

import { FormMessage } from './feedback.js'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: 'primary' | 'secondary' | 'quiet' | 'danger'
    pending?: boolean
}

/**
 * Render a shared action button with an optional pending state.
 * @param props Native button props and visual variant.
 */
export function Button({
    variant = 'primary',
    pending = false,
    disabled,
    className,
    type = 'button',
    ...props
}: ButtonProps) : React.JSX.Element
{
    return (
        <button
            {...props}
            type={type}
            className={['button', `button--${variant}`, className].filter(Boolean).join(' ')}
            disabled={disabled || pending}
            aria-busy={pending || undefined}
        />
    )
}

type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'aria-invalid'> & {
    label: string
    hint?: string
    error?: string
}

/**
 * Render an input with a visible label and associated feedback.
 * @param props Input props, label, and optional hint or error.
 */
export function Field({
    id,
    label,
    hint,
    error,
    'aria-describedby': describedBy,
    ...props
}: FieldProps) : React.JSX.Element
{
    const generatedId = useId()
    const inputId = id ?? generatedId
    const hintId = hint ? `${inputId}-hint` : undefined
    const errorId = error ? `${inputId}-error` : undefined

    // Keep caller-supplied descriptions alongside the field hint and error.
    const descriptions = [describedBy, hintId, errorId].filter(Boolean).join(' ')

    return (
        <div className="field">
            <label htmlFor={inputId}>{label}</label>
            {hint && <FormMessage id={hintId}>{hint}</FormMessage>}

            <input
                {...props}
                id={inputId}
                aria-invalid={error ? true : undefined}
                aria-describedby={descriptions || undefined}
            />

            {error && <FormMessage id={errorId} kind="error">{error}</FormMessage>}
        </div>
    )
}
