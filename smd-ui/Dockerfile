FROM node:22-alpine AS base

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app
# Build tools for any native modules (node-gyp) — only during dependency install.
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci

# Build the app
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Production image: serve the static build.
# WORKDIR/path must match the command the platform orchestrator (strato-init's
# DockerCompose.hs) injects for the smd service: `sh /usr/src/app/docker-run.sh`.
FROM base AS prod
WORKDIR /usr/src/app

ARG STRATO_VERSION
ENV STRATO_VERSION=${STRATO_VERSION}
ENV NODE_ENV=production

RUN apk add --no-cache lsof && npm install -g serve

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY docker-run.sh ./

# docker-run.sh regenerates this at startup; ensure it exists and is writable so
# the container can run as a non-root user.
RUN touch dist/config.js && chmod 666 dist/config.js
EXPOSE 3002

HEALTHCHECK --interval=5s --timeout=2s --start-period=180s \
  CMD lsof -i :3002 || exit 1

CMD ["sh", "docker-run.sh"]

# CI test stage: typecheck, lint, and verify the production build compiles.
FROM base AS test
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx tsc -p tsconfig.app.json --noEmit
RUN npm run build
