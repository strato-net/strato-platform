FROM node:14.21.3-alpine3.17 AS base
RUN apk add --no-cache lsof && \
    mkdir -p /usr/src/app && \
    npm install -g serve@13.0.2
WORKDIR /usr/src/app

FROM base AS npminstaller
COPY package*.json /usr/src/app/
RUN npm ci

### Builder
FROM npminstaller AS builder
COPY . /usr/src/app/
RUN npm run build

### Prod
FROM base AS prod
ARG STRATO_VERSION
ENV STRATO_VERSION=${STRATO_VERSION}
ENV NODE_ENV=production
COPY docker-run.sh /usr/src/app/
COPY --from=builder /usr/src/app/build build/
EXPOSE 3002
HEALTHCHECK --interval=5s --timeout=2s --start-period=180s \
  CMD lsof -i :3002 || \
    exit 1
CMD [ "sh", "/usr/src/app/docker-run.sh" ]

### Test
FROM base AS test
COPY . /usr/src/app
COPY --from=npminstaller /usr/src/app/node_modules /usr/src/app/node_modules/
RUN npm ci
RUN npm test
