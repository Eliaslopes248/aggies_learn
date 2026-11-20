# Backend unit testing

The main server uses Jest in the Node test environment. Tests live in [servers/main/tests](../../servers/main/tests). They exercise service behavior, JWT middleware, and MySQL transaction handling with fake repositories, a fake email provider, and mocked Redis calls. Docker, MySQL, Redis, and SMTP are optional for this suite.

## Run the tests

Use the project's Node.js 26 runtime. From the repository root, install dependencies and run the suite.

```sh
npm --prefix servers/main ci
npm --prefix servers/main run test
```

Run one suite or one named test.

```sh
npm --prefix servers/main run test -- tests/scheduling.test.js
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

| Suite | What it checks |
| --- | --- |
| `auth.test.js` | Registration, password verification, JWT expiry, refresh rotation, and email verification |
| `jwt-middleware.test.js` | Bearer token handling, request identity, and role enforcement |
| `users.test.js` | Profile cache hits, MySQL fallback, cache TTL, and invalidation |
| `catalog.test.js` | Catalog visibility, admin access to archives, and course import validation |
| `tutoring.test.js` | Tutor provisioning, role checks, and active course assignment |
| `scheduling.test.js` | Availability, booking conflicts, cancellation, and notification enqueueing |
| `email-delivery.test.js` | Outbox delivery, retry timing, and overlapping batch requests |
| `database.test.js` | Transaction commit and rollback, connection cleanup, and repository use of a caller's transaction |

## Add a test

Put the test beside the closest existing suite or create `tests/<subsystem>.test.js`. Import Jest helpers from `@jest/globals` and import the compiled module from `../dist/`. Use small objects with `jest.fn()` to supply the dependencies the unit actually calls.

Use fixed timestamps for scheduling and expiry checks. Restore environment variables, spies, and timers after tests that change them. For transaction tests, pass a fake connection and assert that related writes receive that same connection.

The suite checks how the application uses its dependencies. Use separate integration tests with real services to verify MySQL SQL and locking behavior, Redis command semantics, and SMTP delivery.
