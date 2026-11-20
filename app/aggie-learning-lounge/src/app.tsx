import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router'

import { authLink } from './api/auth.navigation.js'
import { createApiClient, type ApiClient, type Profile } from './api/client.js'
import { AppHeader, type AccountRole } from './components/app.header.js'
import { FormMessage, LoadingState } from './components/ui/feedback.js'
import { AccountPage, CredentialsPage, VerificationPage } from './pages/auth.pages.js'
import { CourseDetailPage, CoursesPage } from './pages/courses.page.js'

// Load role-specific workspaces only when their routes are opened.
const AdminCatalogPage = lazy(() => import('./pages/admin.catalog.page.js'))
const AdminTutorsPage = lazy(() => import('./pages/admin.tutors.page.js'))
const AdminBookingsPage = lazy(() => import('./pages/admin.bookings.page.js'))
const TutorCoursesPage = lazy(() => import('./pages/tutor.courses.page.js'))
const SessionsPage = lazy(() => import('./pages/sessions.page.js'))
const TutorCalendarPage = lazy(() => import('./pages/tutor.calendar.page.js'))

/**
 * Render a shell view for a future workspace or a route error.
 * @param props Page title and a description of the next step.
 */
function ShellPage({ title, description }: { title: string; description: string }) : React.JSX.Element
{
    return (
        <section className="shell-page page-width">
            <h1>{title}</h1>
            <p>{description}</p>
            <Link className="button button--primary" to="/courses">Browse courses</Link>
        </section>
    )
}

/**
 * Mount public pages and the authenticated workspace shell.
 * @param props Optional role fixture or API client.
 */
function App({ roles, api: suppliedApi }: { roles?: readonly AccountRole[]; api?: ApiClient }) : React.JSX.Element
{
    // Keep one API client for the lifetime of the shell.
    const [api] = useState(() => suppliedApi ?? createApiClient())
    const [profile, setProfile] = useState<Profile | null | undefined>()
    const [logoutError, setLogoutError] = useState('')

    const location = useLocation()
    const navigate = useNavigate()

    // Restore the session before deciding whether a private route is available.
    const currentRoles = roles ?? profile?.roles ?? []
    const loading = roles === undefined && profile === undefined
    const hasSession = profile != null || Boolean(roles?.length)
    const currentPath = location.pathname + location.search + location.hash
    const restricted = (
        <ShellPage
            title="Access restricted"
            description="This workspace is available to eligible signed-in accounts."
        />
    )

    useEffect(() =>
    {
        if (roles !== undefined)
        {
            return
        }

        let active = true
        void api.getProfile()
            .catch(() => null)
            .then(restored =>
            {
                if (active)
                {
                    // A completed sign-in takes precedence over the initial session check.
                    setProfile(current => current === undefined ? restored : current)
                }
            })

        return () =>
        {
            active = false
        }
    }, [api, roles])

    /**
     * Protect a workspace while restoring the session and checking roles.
     * @param page Workspace to render.
     * @param allowed Whether the account is authorized.
     * @returns Workspace, loading state, or a recovery page.
     */
    function workspace(page: ReactNode, allowed = true) : ReactNode
    {
        if (loading)
        {
            return (
                <div className="shell-page page-width">
                    <LoadingState label="Restoring session" />
                </div>
            )
        }

        if (!hasSession)
        {
            return <Navigate replace to={authLink('/sign-in', currentPath)} />
        }

        return allowed ? page : restricted
    }

    /** Revoke the server session and sign out locally. */
    async function logout() : Promise<void>
    {
        setLogoutError('')

        try
        {
            await api.logout()
        }
        catch
        {
            setLogoutError('The server could not confirm sign-out. Sign out again when it is reachable.')
        }
        finally
        {
            setProfile(null)
            navigate('/sign-in', { replace: true })
        }
    }

    return (
        <>
            <a className="skip-link" href="#main-content">Skip to main content</a>
            <AppHeader key={location.pathname} roles={currentRoles} />

            <main id="main-content" tabIndex={-1}>
                {!profile && logoutError && (
                    <div className="page-width">
                        <FormMessage kind="error">{logoutError}</FormMessage>
                    </div>
                )}

                {currentRoles.includes('admin') && location.pathname.startsWith('/admin/') && (
                    <nav className="page-width section-nav" aria-label="Admin workspace">
                        <NavLink to="/admin/catalog">Catalog</NavLink>
                        <NavLink to="/admin/tutors">Tutors</NavLink>
                        <NavLink to="/admin/bookings">Bookings</NavLink>
                    </nav>
                )}

                {currentRoles.includes('tutor') && location.pathname.startsWith('/tutor/') && (
                    <nav className="page-width section-nav" aria-label="Tutor workspace">
                        <NavLink to="/tutor/calendar">Calendar</NavLink>
                        <NavLink to="/tutor/courses">Assigned courses</NavLink>
                    </nav>
                )}

                <Suspense
                    fallback={
                        <div className="page-width">
                            <LoadingState label="Loading workspace" />
                        </div>
                    }
                >
                    <Routes>
                        {/* Public course discovery */}
                        <Route path="/" element={<Navigate to="/courses" replace />} />
                        <Route path="/courses" element={<CoursesPage api={api} />} />
                        <Route
                            path="/courses/:courseId"
                            element={
                                <CourseDetailPage
                                    api={api}
                                    signedIn={hasSession}
                                    sessionLoading={loading}
                                    profile={profile ?? null}
                                />
                            }
                        />

                        {/* Sign-in and student registration */}
                        <Route
                            path="/sign-in"
                            element={
                                <CredentialsPage
                                    key="login"
                                    api={api}
                                    mode="login"
                                    onProfile={setProfile}
                                />
                            }
                        />
                        <Route
                            path="/register"
                            element={
                                <CredentialsPage
                                    key="register"
                                    api={api}
                                    mode="register"
                                    onProfile={setProfile}
                                />
                            }
                        />
                        <Route
                            path="/verify-email"
                            element={
                                <VerificationPage
                                    key={location.search}
                                    api={api}
                                    profile={profile ?? null}
                                    onProfile={setProfile}
                                />
                            }
                        />

                        {/* Signed-in account and workspaces */}
                        <Route
                            path="/account"
                            element={workspace(profile
                                ? <AccountPage profile={profile} onLogout={logout} />
                                : <ShellPage title="Account" description="Your account details will appear here." />)}
                        />
                        <Route
                            path="/sessions"
                            element={workspace(
                                <SessionsPage api={api} actorId={profile?.id} />,
                            )}
                        />
                        <Route
                            path="/tutor/calendar"
                            element={workspace(
                                <TutorCalendarPage api={api} actorId={profile?.id} />,
                                currentRoles.includes('tutor'),
                            )}
                        />
                        <Route
                            path="/tutor/courses"
                            element={workspace(<TutorCoursesPage api={api} />, currentRoles.includes('tutor'))}
                        />
                        <Route
                            path="/admin/catalog"
                            element={workspace(<AdminCatalogPage api={api} />, currentRoles.includes('admin'))}
                        />
                        <Route
                            path="/admin/tutors"
                            element={workspace(<AdminTutorsPage api={api} />, currentRoles.includes('admin'))}
                        />
                        <Route
                            path="/admin/bookings"
                            element={workspace(<AdminBookingsPage api={api} />, currentRoles.includes('admin'))}
                        />

                        <Route
                            path="*"
                            element={<ShellPage title="Page not found" description="Return to Courses to continue." />}
                        />
                    </Routes>
                </Suspense>
            </main>

            <footer className="app-footer">
                <div className="page-width">
                    Aggie Learning Lounge <span>North Carolina A&amp;T</span>
                </div>
            </footer>
        </>
    )
}

export default App
