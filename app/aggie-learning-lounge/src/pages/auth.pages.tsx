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

import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'

import { jsonWrite, readJson, requestMessage } from '../api/catalog.js'
import { ApiError, type ApiClient, type Profile } from '../api/client.js'
import { authLink, returnPath } from '../api/auth.navigation.js'
import { Button, Field } from '../components/ui/controls.js'
import { FormMessage } from '../components/ui/feedback.js'

/**
 * Present an auth form or account status inside the shared shell.
 * @param props Page heading, optional introduction, body, and full-width account layout.
 */
function AuthPanel({ title, description, children, wide = false }: {
    title: string
    description?: string
    children: ReactNode
    wide?: boolean
}) : React.JSX.Element
{
    return (
        <section className={wide ? 'auth-page page-width account-page' : 'auth-page page-width'} aria-labelledby="auth-heading">
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
 * Edit the signed-in account and show email verification and sign-out controls.
 * @param props API client, current profile, and session callbacks.
 * @returns Account settings page.
 */
export function AccountPage({ api, profile, onUpdate, onLogout }: {
    api: ApiClient
    profile: Profile
    onUpdate: (profile: Profile) => void
    onLogout: () => Promise<void>
}) : React.JSX.Element
{
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [message, setMessage] = useState('')
    const [revision, setRevision] = useState(0)

    /**
     * Save the profile and update the name shown in the app header.
     * @param event Account form submission.
     */
    async function saveProfile(event: FormEvent<HTMLFormElement>) : Promise<void>
    {
        event.preventDefault()
        const fields = Object.fromEntries(new FormData(event.currentTarget))
        setBusy(true)
        setError('')
        setMessage('')

        try
        {
            const updated = await readJson<Profile>(api, '/users/me', jsonWrite('PATCH', fields))
            onUpdate(updated)
            setRevision(current => current + 1)
            setMessage(updated.email !== profile.email
                ? 'Profile saved. Verify your new email address.'
                : 'Profile saved.')
        }
        catch (error)
        {
            setError(requestMessage(error))
        }
        finally
        {
            setBusy(false)
        }
    }

    return (
        <AuthPanel title="Account" wide>
            <form key={revision} className="auth-form account-profile-form" onSubmit={saveProfile}>
                <fieldset disabled={busy} className="account-profile-section">
                    <legend>Personal information</legend>
                    <Field label="First name" name="firstName" autoComplete="given-name" defaultValue={profile.firstName} maxLength={150} required />
                    <Field label="Last name" name="lastName" autoComplete="family-name" defaultValue={profile.lastName} maxLength={150} required />
                </fieldset>

                <fieldset disabled={busy} className="account-profile-section">
                    <legend>Email address</legend>
                    <Field label="Email" name="email" type="email" autoComplete="email" defaultValue={profile.email} maxLength={254} required />
                    {profile.emailVerifiedAt
                        ? <p>Email verified</p>
                        : <Link className="text-link" to="/verify-email">Verify your email</Link>}
                </fieldset>

                <fieldset disabled={busy} className="account-profile-section">
                    <legend>Password</legend>
                    <Field
                        label="Current password"
                        name="currentPassword"
                        type="password"
                        autoComplete="current-password"
                        hint="Required when changing your email or password."
                    />
                    <Field
                        label="New password"
                        name="newPassword"
                        type="password"
                        autoComplete="new-password"
                        minLength={12}
                        hint="Leave blank to keep your current password."
                    />
                </fieldset>

                <div className="record-actions">
                    <Button type="submit" pending={busy}>Save profile</Button>
                </div>
                {message && <FormMessage kind="success">{message}</FormMessage>}
                {error && <FormMessage kind="error">{error}</FormMessage>}
            </form>
            <div className="record-actions">
                <Button variant="secondary" disabled={busy} onClick={() => void onLogout()}>Sign out</Button>
            </div>
        </AuthPanel>
    )
}
