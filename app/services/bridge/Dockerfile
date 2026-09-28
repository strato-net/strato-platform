FROM node:22-alpine AS base


FROM base AS builder

# Install build dependencies only in builder stage
RUN apk add --no-cache python3 make g++

WORKDIR /build

# Pre-install node headers to avoid node-gyp cache issues
RUN npx node-gyp install

COPY package*.json ./

RUN npm ci

COPY tsconfig.json ./

COPY src/ ./src/

RUN npm run build

# Prune dev dependencies to get production-only node_modules
RUN npm prune --omit=dev


FROM base

WORKDIR /app

COPY package*.json ./

# Copy pre-built node_modules from builder (already pruned to production deps)
COPY --from=builder /build/node_modules ./node_modules

COPY --from=builder /build/dist ./dist

EXPOSE 3003

ENV NODE_ENV=production

ENV PORT=3003

CMD ["node", "dist/index.js"] 
