import { courseLabel, readJson, type Course, type TutorAssignment } from './catalog.js'
import { ApiError, type ApiClient } from './client.js'

export type AssignedCourse = TutorAssignment & { label: string }

/**
 * Load assignment labels while preserving references to archived courses.
 * @param api Shared API client.
 * @param path Authorized tutor assignment endpoint.
 * @param signal Cancellation signal for related requests.
 * @returns Active assignments with visible labels.
 */
export async function readAssignedCourses(api: ApiClient, path: string, signal: AbortSignal) : Promise<AssignedCourse[]>
{
    const assignments = await readJson<TutorAssignment[]>(api, path, { authenticated: true, signal })

    return Promise.all(assignments.map(async assignment =>
    {
        try
        {
            const course = await readJson<Course>(api, `/catalog/courses/${assignment.courseId}`, { signal })
            return { ...assignment, label: courseLabel(course) }
        }
        catch (error)
        {
            if (error instanceof ApiError && error.status === 404)
            {
                return { ...assignment, label: `Course ${assignment.courseId} (unavailable in the catalog)` }
            }

            throw error
        }
    }))
}
