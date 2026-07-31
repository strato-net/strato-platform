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

# Optionally refresh geoip-lite's bundled GeoLite2 snapshot (frozen at package
# publish time — stale for reassigned/VPN ranges). Get a free license key at
# maxmind.com and build with:  --build-arg MAXMIND_LICENSE_KEY=...
# The TRACKING_IPINFO_TOKEN live lookup supersedes this at runtime when set.
ARG MAXMIND_LICENSE_KEY=
RUN if [ -n "$MAXMIND_LICENSE_KEY" ]; then \
      cd node_modules/geoip-lite && \
      npm run-script updatedb license_key=$MAXMIND_LICENSE_KEY; \
    fi

COPY --from=builder /build/dist ./dist

COPY docker-run.sh ./docker-run.sh

RUN chmod +x ./docker-run.sh

EXPOSE 3010

ENV NODE_ENV=production

ENV PORT=3010

CMD ["/app/docker-run.sh"]
