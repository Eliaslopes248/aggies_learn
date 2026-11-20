# Development and operations

## Local services

Use the [Compose file](../orchestrate/compose/main.compose.yaml) from the repository root. Docker builds the frontend and API images. The frontend container serves the built Vite bundle through its preview server. MySQL loads the schema and sample course catalog from [the database directory](../servers/main/database/). Redis stores session and cache data, and Mailpit captures outgoing SMTP messages.

```sh
docker compose -f orchestrate/compose/main.compose.yaml ps
docker compose -f orchestrate/compose/main.compose.yaml logs -f main-server frontend
```

If the browser still shows an old build after source edits, rebuild the relevant app container. Use `--no-deps` so development MySQL stays running.

```sh
docker compose -f orchestrate/compose/main.compose.yaml up -d --build --no-deps frontend
```

Add `main-server` to the rebuild command for backend changes. When Compose generates the default JWT signing key, recreating the API generates a new key. An expired or invalid bearer token may trigger session refresh or sign-in.

## Frontend hot reload

Start the API and its dependencies through Compose. Use Node.js 26 and run Vite on the host. The explicit port keeps the browser origin aligned with the default verification URL, so stop the frontend container first if it was started.

```sh
docker compose -f orchestrate/compose/main.compose.yaml stop frontend
docker compose -f orchestrate/compose/main.compose.yaml up -d --build main-server
npm --prefix app/aggie-learning-lounge ci
npm --prefix app/aggie-learning-lounge run dev -- --port 4173 --strictPort
```

Visit [the local app](http://localhost:4173). The Vite development and preview servers forward `/api/*` to `http://127.0.0.1:3000` by default. Set `BACKEND_URL` to use a different API. If the browser origin changes, set `VERIFICATION_URL` to its `/verify-email` page before starting or recreating the API.

## Configuration

| Variable | Service | Purpose |
| --- | --- | --- |
| `BACKEND_URL` | Frontend | API origin for the Vite proxy |
| `PORT` | API | HTTP listener port, default 3000 |
| `APP_MODE` | API | `dev` or `prod`. Production mode sets the Secure flag on refresh cookies |
| `JWT_SECRET` | API | Signing secret of at least 32 bytes. Local Compose generates one at startup when unset |
| `DB_SVC_TYPE` | API | Database backend, currently `mysql` |
| `MYSQL_HOST`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE` | API | MySQL connection settings |
| `REDIS_URL` | API | Redis endpoint for refresh sessions, verification tokens, and profile caching |
| `SMTP_URL`, `MAIL_FROM` | API | SMTP connection and sender for verification, reset, and booking emails |
| `VERIFICATION_URL` | API | Full frontend URL for verification links |
| `CAMPUS_EMAIL_DOMAIN` | API | Optional domain restriction for student registration and student email changes |

## Production routing and storage

Serve the built frontend over HTTPS with a history fallback to `index.html` for client routes such as `/account`. On the same origin, proxy `/api/*` to Express and strip the `/api` prefix. Rewrite refresh cookie paths from `/auth` to `/api/auth` on both set and clear responses.

Configure a stable JWT secret, persistent MySQL and Redis services, and a real SMTP provider. Set `APP_MODE=prod` and point verification links at the deployed frontend. Use versioned [database migrations](../servers/main/database/README.md) for existing databases. The development Compose stack uses temporary storage and sample catalog data.

## Code and tests

- Frontend files live in [src](../app/aggie-learning-lounge/src/). Pages compose UI components, the API client manages session refresh, and the resource hook handles asynchronous loading and stale requests.
- The API initializes connections, repositories, services, and routes in [server.settings.ts](../servers/main/src/settings/server.settings.ts). Express handlers own HTTP parsing and responses, services enforce application rules, and repositories own database queries.
- Frontend checks use Vitest and jsdom with a mock HTTP transport. Run `npm --prefix app/aggie-learning-lounge test`. Backend checks use Jest with mock dependencies and loopback HTTP tests. See the [backend test guide](unittests/testing.infra.md).
- Backend unit tests run in the [GitHub Actions workflow](../.github/workflows/backend-unittests.yml).
