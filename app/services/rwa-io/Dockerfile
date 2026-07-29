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

ENV NODE_ENV=production

HEALTHCHECK --interval=60s --timeout=5s --start-period=10s \
  CMD test -f /tmp/rwa-io-healthy || exit 1

CMD ["node", "dist/index.js"]
