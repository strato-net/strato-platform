FROM node:22-alpine AS base

FROM base AS builder
WORKDIR /build
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM base
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /build/dist ./dist
COPY docker-run.sh ./docker-run.sh
RUN chmod +x ./docker-run.sh

HEALTHCHECK --interval=15s --timeout=3s --start-period=30s \
  CMD wget -qO- http://127.0.0.1:${PORT:-3030}/history-api/health > /dev/null || exit 1

ENTRYPOINT ["/app/docker-run.sh"]
