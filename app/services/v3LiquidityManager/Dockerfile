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

RUN npm ci --omit=dev

COPY --from=builder /build/dist ./dist

EXPOSE 3007

ENV NODE_ENV=production

HEALTHCHECK --interval=60s --timeout=5s --start-period=30s \
  CMD wget -qO- http://localhost:${HEALTH_PORT:-3007}/health || exit 1

CMD ["node", "dist/index.js"]
