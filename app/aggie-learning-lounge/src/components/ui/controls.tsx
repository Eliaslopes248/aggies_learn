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
