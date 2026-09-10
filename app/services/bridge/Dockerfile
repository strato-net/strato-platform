# Build context is ./app (see Makefile) so that ../../packages/shared-types
# is reachable, mirroring the app-backend and app-ui builds.
FROM node:22-alpine AS base


FROM base AS builder

# Install build dependencies only in builder stage
RUN apk add --no-cache python3 make g++

WORKDIR /build/services/bridge

# Pre-install node headers to avoid node-gyp cache issues
RUN npx node-gyp install

# Local workspace dependency (@strato/shared-types via file:../../packages/shared-types)
COPY packages/shared-types/ /build/packages/shared-types/

COPY services/bridge/package*.json ./

# postinstall builds ../../packages/shared-types
RUN npm ci

COPY services/bridge/tsconfig.json ./

COPY services/bridge/src/ ./src/

RUN npm run build

# Prune dev dependencies to get production-only node_modules
RUN npm prune --omit=dev


FROM base

WORKDIR /app/services/bridge

COPY services/bridge/package*.json ./

# node_modules/@strato/shared-types is a relative symlink to ../../packages/shared-types,
# so keep the same directory layout as the builder stage.
COPY --from=builder /build/packages/shared-types/package.json /app/packages/shared-types/
COPY --from=builder /build/packages/shared-types/dist /app/packages/shared-types/dist

# Copy pre-built node_modules from builder (already pruned to production deps)
COPY --from=builder /build/services/bridge/node_modules ./node_modules

COPY --from=builder /build/services/bridge/dist ./dist

EXPOSE 3003

ENV PORT=3003

CMD ["node", "dist/index.js"]
