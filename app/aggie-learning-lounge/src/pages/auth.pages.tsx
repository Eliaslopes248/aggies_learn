import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'

import { ApiError, type ApiClient, type Profile } from '../api/client.js'
import { authLink, returnPath } from '../api/auth.navigation.js'
import { Button, Field } from '../components/ui/controls.js'
import { FormMessage } from '../components/ui/feedback.js'

/**
 * Present an auth form or account status inside the shared shell.
 * @param props Page heading, optional introduction, and body.
 */
function AuthPanel({ title, description, children }: { title: string; description?: string; children: ReactNode }) : React.JSX.Element
{
    return (
        <section className="auth-page page-width" aria-labelledby="auth-heading">
            <div className="auth-panel">
                <h1 id="auth-heading">{title}</h1>
                {description && <p className="auth-description">{description}</p>}
                {children}
            </div>
        </section>
    )
}

/**
 * Collect credentials for sign-in or student registration.
 * @param props API client, form mode, and profile update callback.
 */
export function CredentialsPage({ api, mode, onProfile }: {
    api: ApiClient
    mode: 'login' | 'register'
    onProfile: (profile: Profile) => void
}) : React.JSX.Element
{
    const [params] = useSearchParams()
    const navigate = useNavigate()

    const [pending, setPending] = useState(false)
    const [error, setError] = useState('')
    const [showPassword, setShowPassword] = useState(false)

    const registering = mode === 'register'
    const next = returnPath(params.get('next'))

    /**
     * Submit the current form to the selected auth endpoint.
     * @param event Native form submission.
     */
    async function submit(event: FormEvent<HTMLFormElement>) : Promise<void>
    {
        event.preventDefault()
        const fields = new FormData(event.currentTarget)
        const credentials = {
            email: String(fields.get('email')).trim(),
            password: String(fields.get('password')),
        }

        setPending(true)
        setError('')

        try
        {
            const profile = registering
                ? await api.register({
                    ...credentials,
                    firstName: String(fields.get('firstName')).trim(),
                    lastName: String(fields.get('lastName')).trim(),
                })
                : await api.login(credentials)

            onProfile(profile)

            if (registering)
            {
                // Keep the return path in this tab while the student opens the email.
                sessionStorage.setItem('aggies-verification-return', next)
            }

            navigate(registering ? authLink('/verify-email', next) : next, { replace: true })
        }
        catch (error)
        {
            setError(error instanceof ApiError ? error.message : 'Unable to reach the server. Please try again.')
        }
        finally
        {
            setPending(false)
        }
    }

    return (
        <AuthPanel
            title={registering ? 'Create a student account' : 'Sign in'}
            description={registering ? 'Use your campus email to find and book tutoring.' : 'Sign in to Aggie Learning Lounge.'}
        >
            <form className="auth-form" onSubmit={submit}>
                {/* Name fields are collected only when creating an account. */}
                {registering && (
                    <div className="auth-name-fields">
                        <Field
                            label="First name"
                            name="firstName"
                            autoComplete="given-name"
                            required
                            maxLength={150}
                        />
                        <Field
                            label="Last name"
                            name="lastName"
                            autoComplete="family-name"
                            required
                            maxLength={150}
                        />
                    </div>
                )}

                <Field
                    label={registering ? 'Campus email' : 'Email'}
                    name="email"
                    type="email"
                    autoComplete="username"
                    spellCheck={false}
                    required
                    maxLength={254}
                />

                <div className="auth-password">
                    <Field
                        label="Password"
                        name="password"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete={registering ? 'new-password' : 'current-password'}
                        required
                        minLength={registering ? 12 : undefined}
                        hint={registering ? 'Use at least 12 characters.' : undefined}
                    />
                    <Button
                        variant="quiet"
                        aria-pressed={showPassword}
                        onClick={() => setShowPassword(show => !show)}
                    >
                        {showPassword ? 'Hide password' : 'Show password'}
                    </Button>
                </div>

                {error && <FormMessage kind="error">{error}</FormMessage>}
                <Button type="submit" pending={pending}>
                    {registering ? 'Create account' : 'Sign in'}
                </Button>
            </form>

            <p className="auth-switch">
                {registering ? 'Already have an account? ' : 'New student? '}
                <Link to={authLink(registering ? '/sign-in' : '/register', next)}>
                    {registering ? 'Sign in' : 'Create an account'}
                </Link>
            </p>
        </AuthPanel>
    )
}

/**
 * Confirm an email link or let a signed-in account request another one.
 * @param props API client, current profile, and profile update callback.
 */
export function VerificationPage({ api, profile, onProfile }: {
    api: ApiClient
    profile: Profile | null
    onProfile: (profile: Profile) => void
}) : React.JSX.Element
{
    const [params] = useSearchParams()
    const [state, setState] = useState<'pending' | 'verified' | 'expired'>('pending')
    const [busy, setBusy] = useState(false)
    const [message, setMessage] = useState('')
    const [error, setError] = useState('')

    const token = params.get('token')
    const next = returnPath(params.get('next') ?? sessionStorage.getItem('aggies-verification-return'))
    const verified = state === 'verified' || (!token && Boolean(profile?.emailVerifiedAt))

    /** Confirm the token when the user submits the verification action. */
    async function verify() : Promise<void>
    {
        if (!token)
        {
            return
        }

        setBusy(true)
        setError('')

        try
        {
            await api.verifyEmail(token)
            setState('verified')

            if (profile)
            {
                // Verification has succeeded even if refreshing the profile fails.
                const current = await api.getProfile().catch(() => null)

                if (current)
                {
                    onProfile(current)
                }
            }
        }
        catch (error)
        {
            if (error instanceof ApiError && error.status === 400)
            {
                setState('expired')
            }
            else
            {
                setError(error instanceof ApiError ? error.message : 'Unable to reach the server. Please try again.')
            }
        }
        finally
        {
            setBusy(false)
        }
    }

    /** Request a fresh verification link for the current account. */
    async function resend() : Promise<void>
    {
        setBusy(true)
        setError('')
        setMessage('')

        try
        {
            await api.resendVerification()
            setMessage('A new verification link was sent.')
        }
        catch (error)
        {
            setError(error instanceof ApiError ? error.message : 'Unable to reach the server. Please try again.')
        }
        finally
        {
            setBusy(false)
        }
    }

    if (verified)
    {
        return (
            <AuthPanel title="Email verified" description="You can continue to course discovery.">
                <Link
                    className="button button--primary"
                    to={profile ? next : authLink('/sign-in', next)}
                    onClick={() => sessionStorage.removeItem('aggies-verification-return')}
                >
                    Continue
                </Link>
            </AuthPanel>
        )
    }

    return (
        <AuthPanel
            title={state === 'expired' ? 'Verification link expired' : 'Verify your email'}
            description={state === 'expired' ? 'Request a new link to verify your address.'
                : token ? 'Confirm your campus email address to continue.'
                    : 'Open the verification link in your inbox before booking a session.'}
        >
            {/* An email link can be verified without a session. Resending requires sign-in. */}
            <div className="auth-actions">
                {token && state !== 'expired' && (
                    <Button pending={busy} onClick={() => void verify()}>Verify email</Button>
                )}

                {profile && (
                    <Button variant="secondary" pending={busy} onClick={() => void resend()}>
                        Resend verification
                    </Button>
                )}

                {!profile && (!token || state === 'expired') && (
                    <Link
                        className="button button--primary"
                        to={authLink('/sign-in', authLink('/verify-email', next))}
                    >
                        Sign in to resend
                    </Link>
                )}

                <Link className="button button--quiet" to={next}>Browse courses</Link>
            </div>

            {message && <FormMessage kind="success">{message}</FormMessage>}
            {error && <FormMessage kind="error">{error}</FormMessage>}
        </AuthPanel>
    )
}

/**
 * Show the signed-in account and its sign-out action.
 * @param props Current profile and callback to end the session.
 */
export function AccountPage({ profile, onLogout }: { profile: Profile; onLogout: () => Promise<void> }) : React.JSX.Element
{
    return (
        <AuthPanel
            title="Account"
            description={`${profile.firstName} ${profile.lastName} · ${profile.email}`}
        >
            <div className="auth-actions">
                {!profile.emailVerifiedAt && (
                    <Link className="button button--secondary" to="/verify-email">
                        Verify your email
                    </Link>
                )}

                <Button onClick={() => void onLogout()}>Sign out</Button>
            </div>
        </AuthPanel>
    )
}
