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
EXPOSE 3004
ENV NODE_ENV=production
ENV PORT=3004
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD wget -q -O- http://127.0.0.1:3004/health || exit 1
CMD ["node", "dist/index.js"]
