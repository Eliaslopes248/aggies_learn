# Backend unit testing

The main server uses Jest in the Node test environment. Tests live in [servers/main/tests](../../servers/main/tests). Service and database tests use fake dependencies. Route tests start the Express app on an ephemeral loopback port and use fake services. The suite runs without Docker, MySQL, Redis, or SMTP.

## Run the tests

Use the project's Node.js 26 runtime. From the repository root, install dependencies and run the suite.

```sh
npm --prefix servers/main ci
npm --prefix servers/main run test
```

Run one suite or one named test.

```sh
npm --prefix servers/main run test -- tests/services/scheduling.test.js
npm --prefix servers/main run test -- tests/routes
npm --prefix servers/main run test -- --testNamePattern="rotates refresh tokens"
```

Generate a coverage report.

```sh
npm --prefix servers/main run test -- --coverage
```

Jest reports coverage for the compiled modules loaded by the tests.

## How the runner works

The [server package configuration](../../servers/main/package.json) builds TypeScript into `servers/main/dist` before running Jest. Jest loads ESM directly through Node's `--experimental-vm-modules` flag, runs the tests serially, and discovers files matching `tests/**/*.test.js`. Node can print an experimental VM modules warning during a successful run.

## Suite layout

| Directory | What it checks |
| --- | --- |
| `tests/services/` | Auth, profile caching, catalog, tutoring, scheduling, booking, and email delivery |
| `tests/middleware/` | Bearer token handling, request identity, and role enforcement |
| `tests/database/` | MySQL and Redis connection lifecycle, transaction commit and rollback, and connection cleanup |
| `tests/repositories/` | Query parameters, ownership checks, retry behavior, and use of the caller's transaction |
| `tests/routes/` | HTTP requests across auth, users, catalog, tutors, availability, and bookings |

## Add a test

Put the test beside the closest existing suite under `tests/<directory>/`. Import Jest helpers from `@jest/globals` and import the compiled module from `../../dist/`. Use small objects with `jest.fn()` to supply the dependencies under test.

Use fixed timestamps for scheduling and expiry checks. Restore environment variables, spies, and timers after tests that change them. For transaction tests, pass a fake connection and assert that related writes receive that same connection.

The suite checks how the application uses its dependencies. Use separate integration tests with real services to verify MySQL SQL and locking behavior, Redis command semantics, and SMTP delivery.
