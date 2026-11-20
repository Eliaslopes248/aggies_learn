# Use the same Node.js version as the backend image
FROM node:26-bookworm-slim

WORKDIR /app
RUN chown node:node /app
USER node

# Install dependencies from the lockfile
COPY package.json package-lock.json ./
RUN npm ci

# Copy the frontend source and build the static assets
COPY index.html tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts ./
COPY public/ ./public/
COPY src/ ./src/
RUN npm run build

# Serve the build with the existing API proxy for local development
EXPOSE 4173
CMD ["node", "node_modules/vite/bin/vite.js", "preview", "--host", "0.0.0.0", "--port", "4173", "--strictPort"]
