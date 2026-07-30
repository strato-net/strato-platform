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
COPY --from=builder /build/src/config ./dist/config

EXPOSE 3000

ENV NODE_ENV=production

ENV PORT=3000

# Add health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD lsof -i :3000 || exit 1

CMD ["node", "dist/index.js"]
