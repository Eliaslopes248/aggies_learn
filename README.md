# Aggie Learning Lounge

Aggie Learning Lounge is a tutoring platform for North Carolina A&T students. Students find courses and book tutoring, tutors manage their schedules, and administrators maintain the catalog, accounts, and bookings.

| Workspace | What you can do |
| --- | --- |
| **Courses** | Browse the public course catalog and filter by college, department, or search term. Sign in to see tutors and open times. |
| **Account** | Register, verify your email, and edit your name, email, or password. |
| **My Sessions** | Book a session from a course page after verifying your student email. View your confirmed location and cancel eligible sessions. |
| **Tutor** | See your assigned courses, publish availability with a room or meeting link, and review upcoming sessions. |
| **Admin** | Manage colleges, departments, and courses. Provision tutors and assign courses. Search students, edit names, set passwords or email resets, and review or cancel bookings. |

## Run locally

From the repository root, use Docker with the Compose plugin.

```sh
docker compose -f orchestrate/compose/main.compose.yaml up -d --build
```

- Open the [web app](http://localhost:4173/courses).
- Open [Mailpit](http://localhost:8025) to read local verification, password reset, and booking emails.
- The API listens on port 3000. The web app sends requests through its same-origin `/api` proxy.

Register a student from the app and use the verification link in Mailpit. The initial database contains a sample Computer Science catalog. Follow the [local admin setup](docs/accounts.md#first-local-admin) to provision tutors and manage the catalog. For a test booking, use separate student and tutor accounts, assign the tutor to a course, and publish an availability block on the tutor calendar.

The development MySQL and Redis services use in-memory storage. Restarting MySQL resets the local catalog and removes accounts and bookings added through the app. Rebuild only the app services to pick up source changes while keeping the database running.

```sh
docker compose -f orchestrate/compose/main.compose.yaml up -d --build --no-deps main-server frontend
```

For frontend hot reload, deployment settings, and debugging, see [Development and operations](docs/development.md).

## Architecture

The React and TypeScript frontend uses Vite, React Router, and Tailwind CSS. It calls an Express API that delegates application rules to services and database access to MySQL repositories. MySQL owns accounts, roles, the catalog, availability, bookings, and the booking email outbox. Redis stores refresh sessions, short-lived verification tokens, and cached account profiles. SMTP delivers account and booking emails.

| Path | Responsibility |
| --- | --- |
| [app/aggie-learning-lounge](app/aggie-learning-lounge/) | Browser app, route workspaces, reusable UI, API client, and frontend tests |
| [servers/main/src](servers/main/src/) | Express routes, authentication, services, repositories, and email worker |
| [servers/main/database](servers/main/database/) | MySQL schema, local seed data, and migrations |
| [orchestrate/compose](orchestrate/compose/) | Local frontend, API, MySQL, Redis, and Mailpit services |
| [docs](docs/) | Subsystem guides and testing documentation |

## Subsystem guides

- [Accounts, access, and student administration](docs/accounts.md)
- [Course catalog and tutor assignments](docs/catalog-and-tutors.md)
- [Availability, bookings, and email delivery](docs/scheduling.md)
- [Development, configuration, and deployment](docs/development.md)
- [Backend testing infrastructure](docs/unittests/testing.infra.md)
- [Database schema and migration notes](servers/main/database/README.md)

## Run checks

Use Node.js 26 and npm for host-side development. Tests use mocked dependencies, and the backend route tests also need access to an ephemeral loopback port.

```sh
npm --prefix app/aggie-learning-lounge ci
npm --prefix servers/main ci
npm --prefix app/aggie-learning-lounge run build
npm --prefix app/aggie-learning-lounge test
npm --prefix servers/main test
```
