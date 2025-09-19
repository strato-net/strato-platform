FROM node:22-alpine AS base


FROM base AS builder

WORKDIR /build

# Copy shared types package first
COPY packages/shared-types/ ./packages/shared-types/

# Build shared types package
WORKDIR /build/packages/shared-types
RUN npm ci && npm run build

# Copy backend package files
WORKDIR /build
COPY backend/package*.json ./

# Install backend dependencies and ensure shared-types is properly linked
RUN npm ci && npm install ./packages/shared-types

COPY backend/tsconfig.json ./

COPY backend/src/ ./src/

RUN npm run build


FROM base

WORKDIR /app

COPY backend/package*.json ./

RUN npm ci --omit=dev

COPY --from=builder /build/dist ./dist

EXPOSE 3001

ENV NODE_ENV=production

ENV PORT=3001

# Add health check
HEALTHCHECK --interval=5s --timeout=2s --start-period=180s \
  CMD lsof -i :3001 || \
    exit 1

CMD ["node", "dist/app.js"] 
