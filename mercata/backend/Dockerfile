FROM node:22-alpine AS base


FROM base AS builder

WORKDIR /build

COPY packages/shared-types/ ../packages/shared-types/

COPY backend/package*.json ./

RUN npm ci

COPY backend/tsconfig.json ./

COPY backend/src/ ./src/

RUN npm run build


FROM base

WORKDIR /app

COPY backend/package*.json ./

RUN npm ci --omit=dev

# TODO: fix this hack - include the @shared as runtime dep without rebuilding, but omit the dev deps still
COPY --from=builder /build/node_modules/@shared/ ./node_modules/@shared/

COPY --from=builder /build/dist ./dist

EXPOSE 3001

ENV NODE_ENV=production

ENV PORT=3001

# Add health check
HEALTHCHECK --interval=5s --timeout=2s --start-period=180s \
  CMD lsof -i :3001 || \
    exit 1

CMD ["node", "dist/app.js"] 
