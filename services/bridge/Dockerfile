FROM node:22-alpine AS base


FROM base AS builder

# Install build dependencies only in builder stage
RUN apk add --no-cache python3 make g++

WORKDIR /build

COPY package*.json ./

RUN npm ci

COPY tsconfig.json ./

COPY src/ ./src/

RUN npm run build


FROM base

WORKDIR /app

COPY package*.json ./

# Install build dependencies, run npm ci, then remove them in one layer
RUN apk add --no-cache python3 make g++ \
    && npm ci --omit=dev \
    && apk del python3 make g++ \
    && npm cache clean --force

COPY --from=builder /build/dist ./dist

EXPOSE 3003

ENV NODE_ENV=production

ENV PORT=3003

CMD ["node", "dist/index.js"] 
