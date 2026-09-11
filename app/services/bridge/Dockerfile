FROM node:22-alpine AS base


FROM base AS builder

# Install build dependencies only in builder stage
RUN apk add --no-cache python3 make g++

WORKDIR /build/services/bridge

# Pre-install node headers to avoid node-gyp cache issues
RUN npx node-gyp install

COPY services/bridge/package*.json ./

COPY packages/shared-types/ ../../packages/shared-types/

RUN npm ci

COPY services/bridge/tsconfig.json ./

COPY services/bridge/src/ ./src/

RUN npm run build

# Prune dev dependencies to get production-only node_modules
RUN npm prune --omit=dev


FROM base

WORKDIR /app

RUN chown node:node /app

COPY services/bridge/package*.json ./

# Copy pre-built node_modules from builder (already pruned to production deps)
COPY --from=builder /build/services/bridge/node_modules ./node_modules

COPY --from=builder /build/services/bridge/dist ./dist

EXPOSE 3003

ENV PORT=3003

USER node

CMD ["node", "dist/index.js"] 
