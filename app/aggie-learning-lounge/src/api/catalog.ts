import { ApiError, type ApiClient } from './client.js'

export interface College
{
    id: string
    name: string
    archivedAt: string | null
}

export interface Department extends College
{
    collegeId: string
}

export interface Course
{
    id: string
    departmentId: string
    subjectCode: string
    courseNumber: string
    title: string
    archivedAt: string | null
}

export type CourseInput = Pick<Course, 'departmentId' | 'subjectCode' | 'courseNumber' | 'title'>
export type Tutor = { id: string; firstName: string; lastName: string }
export type TutorAssignment = { tutorId: string; courseId: string }

/**
 * Read a typed JSON response through the shared API client.
 * @param api Current API client.
 * @param path Backend resource path.
 * @param options Request options.
 * @returns Parsed response body.
 */
export async function readJson<T>(api: ApiClient, path: string, options?: Parameters<ApiClient['request']>[1]) : Promise<T>
{
    return (await api.request(path, options)).json()
}

/**
 * Build the fetch options for a JSON write.
 * @param method HTTP method to send.
 * @param body Request payload.
 * @returns Authenticated JSON request options.
 */
export function jsonWrite(method: 'POST' | 'PATCH', body: unknown) : NonNullable<Parameters<ApiClient['request']>[1]>
{
    return {
        method,
        authenticated: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    }
}

/**
 * Return a user-facing message for a failed API operation.
 * @param error Error from the request.
 * @returns Message to display.
 */
export function requestMessage(error: unknown) : string
{
    return error instanceof ApiError ? error.message : 'Unable to reach the server. Please try again.'
}

/**
 * Format a course label for results and selectors.
 * @param course Course being displayed.
 * @returns Course code and title.
 */
export function courseLabel(course: Course) : string
{
    return `${course.subjectCode} ${course.courseNumber} — ${course.title}`
}
