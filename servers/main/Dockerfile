# Get the Node.js 26 runtime
FROM node:26-bookworm-slim AS node-runtime

FROM ubuntu:24.04

# Install the Node runtime libraries and CA certificates
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libatomic1 \
    && rm -rf /var/lib/apt/lists/*

# Copy Node and npm into the Ubuntu image
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node-runtime /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm

WORKDIR /app

# Install dependencies from the lockfile
COPY package.json package-lock.json ./
RUN npm ci

# Build the server and remove development dependencies
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build && npm prune --omit=dev

EXPOSE 3000
# Run Node directly so it receives shutdown signals
CMD ["node", "dist/index.js"]
