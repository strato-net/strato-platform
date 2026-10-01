FROM node:22-alpine AS base


FROM base AS builder

# Install build dependencies only in builder stage
RUN apk add --no-cache python3 make g++

WORKDIR /build/services/bridge-eab

# Pre-install node headers to avoid node-gyp cache issues
RUN npx node-gyp install

COPY services/bridge-eab/package*.json ./

COPY packages/shared-types/ ../../packages/shared-types/

RUN npm ci

COPY services/bridge-eab/tsconfig.json ./

COPY services/bridge-eab/src/ ./src/

RUN npm run build

# Prune dev dependencies to get production-only node_modules
RUN npm prune --omit=dev


FROM base

WORKDIR /app

RUN chown node:node /app

COPY services/bridge-eab/package*.json ./

# Copy pre-built node_modules from builder (already pruned to production deps)
COPY --from=builder /build/services/bridge-eab/node_modules ./node_modules

COPY --from=builder /build/packages/shared-types/package.json /packages/shared-types/package.json
COPY --from=builder /build/packages/shared-types/dist /packages/shared-types/dist

COPY --from=builder /build/services/bridge-eab/dist ./dist

EXPOSE 3003

ENV PORT=3003

USER node

RUN node -e "require('./dist/utils/routeQuoteUtils')"

CMD ["node", "dist/index.js"]
