import { useEffect, useState } from 'react'

import { requestMessage } from '../api/catalog.js'

type Loader<T> = (signal: AbortSignal) => Promise<T>
type Result<T> = { data?: T; error?: string; pending: boolean }

/**
 * Load data for the current request and ignore obsolete responses.
 * @param load Memoized loader or null when the view needs no request.
 * @returns Request state and a retry action.
 */
export function useResource<T>(load: Loader<T> | null) : Result<T> & { reload: () => void }
{
    const [revision, setRevision] = useState(0)
    const [result, setResult] = useState<{ load: Loader<T>; revision: number; value: Result<T> }>()

    useEffect(() =>
    {
        if (!load)
        {
            return
        }

        const controller = new AbortController()
        void load(controller.signal)
            .then(data =>
            {
                if (!controller.signal.aborted)
                {
                    setResult({ load, revision, value: { data, pending: false } })
                }
            })
            .catch(error =>
            {
                if (!controller.signal.aborted)
                {
                    setResult({ load, revision, value: { error: requestMessage(error), pending: false } })
                }
            })

        return () => controller.abort()
    }, [load, revision])

    const current = result?.load === load && result.revision === revision ? result.value : { pending: Boolean(load) }
    return { ...current, reload: () => setRevision(value => value + 1) }
}
