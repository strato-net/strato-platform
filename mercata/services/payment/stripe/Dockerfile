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

EXPOSE 3002

ENV NODE_ENV=production

ENV PORT=3002

CMD ["node", "dist/app.js"] 