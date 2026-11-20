# Aggie Learning Lounge frontend

This React, TypeScript, and Vite app provides course discovery, student accounts and bookings, tutor scheduling, and admin workspaces.

- [Project overview and local setup](../../README.md)
- [Frontend hot reload and API proxy configuration](../../docs/development.md#frontend-hot-reload)
- [Deployment routing and refresh cookie configuration](../../docs/development.md#production-routing-and-storage)

With Node.js 26, run these commands from this directory.

```sh
npm ci
npm run dev -- --port 4173 --strictPort
npm test
npm run build
```

Start the API separately through Compose for interactive development and keep port 4173 free for Vite. The default Vite API destination is `http://127.0.0.1:3000`. Set `BACKEND_URL` for a different API origin.
