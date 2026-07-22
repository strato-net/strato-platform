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

EXPOSE 3010

ENV NODE_ENV=production

ENV PORT=3010

CMD ["/app/docker-run.sh"]
