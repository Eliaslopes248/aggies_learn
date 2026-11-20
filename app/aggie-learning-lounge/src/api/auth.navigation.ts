/**
 * Validate the post-auth return destination.
 * @param value Return path from the query string.
 * @returns Safe local destination or the course catalog.
 */
export function returnPath(value: string | null): string
{
    if (!value?.startsWith('/') || value.startsWith('//') || value.includes('\\'))
    {
        return '/courses'
    }

    const url = new URL(value, 'https://app.invalid')
    if (url.origin !== 'https://app.invalid' || url.pathname.startsWith('//') || /^\/(sign-in|register)\/?$/i.test(url.pathname))
    {
        return '/courses'
    }

    return url.pathname + url.search + url.hash
}

/**
 * Build an auth link with a local return destination.
 * @param path Auth page to open.
 * @param next Local destination after the flow.
 * @returns Link including the return query.
 */
export function authLink(path: string, next: string): string
{
    return `${path}?${new URLSearchParams({ next })}`
}
