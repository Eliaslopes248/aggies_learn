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
