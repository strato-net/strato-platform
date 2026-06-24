FROM node:22-alpine AS base

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app
# Add Python and build tools for native modules (node-gyp) only during dependency installation (required for arm64 builds)
RUN apk add --no-cache python3 make g++
# Copy shared types package first
COPY packages/shared-types/ ../packages/shared-types/
COPY ui/package*.json ./
RUN npm ci

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
# Copy UI source code
COPY ui/ .
RUN npm run build

# Production image, copy built assets and serve with a lightweight server
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN npm install -g serve

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY ui/docker-run.sh ./

# docker-run.sh regenerates this at startup; make it writable so the container
# can run as a non-root user.
RUN touch dist/config.js && chmod 666 dist/config.js

EXPOSE 8080

# Add health check
HEALTHCHECK --interval=5s --timeout=2s --start-period=180s \
  CMD lsof -i :8080 || \
    exit 1

CMD ["sh", "docker-run.sh"]
