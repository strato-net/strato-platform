# STRATO tracking CI/CD bot. Needs git + make (workspace ops, BUILD_METADATA),
# and the docker CLI + compose plugin to run the tracking integration suite
# against the host daemon (mount /var/run/docker.sock).
FROM node:22-bookworm-slim AS builder

WORKDIR /build

COPY package*.json ./

RUN npm ci

COPY tsconfig.json ./

COPY src/ ./src/

RUN npm run build && npm prune --omit=dev


FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg git make bash coreutils grep openssh-client \
 && install -m 0755 -d /etc/apt/keyrings \
 && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
 && chmod a+r /etc/apt/keyrings/docker.asc \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" > /etc/apt/sources.list.d/docker.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends docker-ce-cli docker-compose-plugin docker-buildx-plugin \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/dist ./dist
COPY package.json ./

ENV NODE_ENV=production
ENV WORKSPACE_DIR=/var/lib/tracking-bot
ENV PORT=3020

VOLUME ["/var/lib/tracking-bot"]

EXPOSE 3020

HEALTHCHECK --interval=60s --timeout=5s --start-period=120s \
  CMD node -e "fetch('http://localhost:3020/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
