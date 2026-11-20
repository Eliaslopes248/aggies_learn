import type { AccountRole } from '../components/app.header.js'

export type Profile = {
    id: string
    email: string
    firstName: string
    lastName: string
    emailVerifiedAt: string | null
    roles: AccountRole[]
}

export type Credentials = { email: string; password: string }

export type Registration = Credentials & {
    firstName: string
    lastName: string
}

export class ApiError extends Error {
    readonly status: number

    /**
     * Represent an API response that could not be completed.
     * @param status HTTP response status.
     * @param message Message to show the user.
     */
    constructor(status: number, message: string)
    {
        super(message)
        this.status = status
    }
}

/**
 * Read an HTTP error returned by the API.
 * @param response Failed HTTP response.
 * @returns Error with the HTTP status and user-facing message.
 */
async function responseError(response: Response): Promise<ApiError>
{
    const body = await response.json().catch(() => null)
    const message = typeof body?.error === 'string' ? body.error : 'The request could not be completed.'
    return new ApiError(response.status, message)
}

/**
 * Create a same-origin API client with an in-memory access token.
 * @param send Fetch function used to send API requests.
 * @returns Session methods and the shared request function.
 */
export function createApiClient(send: typeof fetch = fetch) : ApiClient
{
    let accessToken: string | undefined
    let refreshRequest: Promise<void> | undefined

    /**
     * Save the access token from a successful auth response.
     * @param response Auth response containing the bearer token.
     */
    function saveAccessToken(response: Response) : void
    {
        const token = /^Bearer (\S+)$/i.exec(response.headers.get('Authorization') ?? '')?.[1]
        if (!token)
        {
            throw new ApiError(502, 'The server did not return an access token.')
        }

        accessToken = token
    }

    /** Share a single cookie refresh across simultaneous requests. */
    function refresh() : Promise<void>
    {
        refreshRequest ??= send('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' })
            .then(async response =>
            {
                if (!response.ok)
                {
                    accessToken = undefined
                    throw await responseError(response)
                }

                saveAccessToken(response)
            })
            .finally(() =>
            {
                refreshRequest = undefined
            })

        return refreshRequest
    }

    /**
     * Send an API request and retry an authenticated request once after a 401.
     * @param path Backend path without the /api prefix.
     * @param init Fetch options with an optional authentication requirement.
     * @returns Successful response.
     */
    async function request(path: string, { authenticated = false, ...init }: RequestInit & { authenticated?: boolean } = {}) : Promise<Response>
    {
        if (authenticated && !accessToken)
        {
            await refresh()
        }

        const sentToken = authenticated ? accessToken : undefined
        const headers = new Headers(init.headers)
        if (sentToken)
        {
            headers.set('Authorization', `Bearer ${sentToken}`)
        }

        const options: RequestInit = { ...init, credentials: 'same-origin', headers }
        let response = await send(`/api${path}`, options)
        if (authenticated && response.status === 401)
        {
            if (accessToken === sentToken || !accessToken)
            {
                await refresh()
            }

            if (!accessToken)
            {
                throw new ApiError(401, 'Sign in to continue.')
            }

            headers.set('Authorization', `Bearer ${accessToken}`)
            response = await send(`/api${path}`, { ...options, headers })
        }

        if (!response.ok)
        {
            throw await responseError(response)
        }

        return response
    }

    /** Get the current profile, restoring the cookie session if needed. */
    async function getProfile() : Promise<Profile>
    {
        const response = await request('/users/me', { authenticated: true })
        return response.json()
    }

    /**
     * Submit credentials and load the current server-authorized roles.
     * @param path Login or registration endpoint.
     * @param input Credentials or student registration details.
     * @returns Signed-in profile.
     */
    async function authenticate(path: string, input: Credentials | Registration) : Promise<Profile>
    {
        // Avoid letting a refresh that started during app load overwrite the new session.
        await refreshRequest?.catch(() => undefined)
        const response = await request(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
        })
        saveAccessToken(response)
        return getProfile()
    }

    /** Revoke the refresh session and clear the in-memory token. */
    async function logout() : Promise<void>
    {
        // Let a concurrent rotation finish before the server clears its replacement cookie.
        try
        {
            await refreshRequest
        }
        catch
        {
            // A failed refresh can still be followed by logout.
        }

        accessToken = undefined
        await request('/auth/logout', { method: 'POST' })
    }

    return {
        request,
        getProfile,
        login: (input: Credentials) => authenticate('/auth/login', input),
        register: (input: Registration) => authenticate('/users', input),
        logout,
        /**
         * Submit the token from an email verification link.
         * @param token One-time verification token.
         */
        async verifyEmail(token: string)
        {
            await request('/auth/verify-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token }),
            })
        },
        /**
         * Request a new verification email for the signed-in account.
         */
        async resendVerification()
        {
            await request('/auth/resend-verification', { method: 'POST', authenticated: true })
        },
    }
}

export interface ApiClient
{
    request(path: string, init?: RequestInit & { authenticated?: boolean }): Promise<Response>
    getProfile() : Promise<Profile>
    login(input: Credentials): Promise<Profile>
    register(input: Registration): Promise<Profile>
    logout() : Promise<void>
    verifyEmail(token: string) : Promise<void>
    resendVerification() : Promise<void>
}
