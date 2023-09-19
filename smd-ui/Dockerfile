FROM node:14-bullseye-slim as base
RUN mkdir -p /usr/src/app && \
    npm install -g serve@11.3.2
WORKDIR /usr/src/app

FROM base as npminstaller
COPY package*.json /usr/src/app
RUN npm install

### Builder
FROM npminstaller as builder
COPY . /usr/src/app
RUN npm run build

### Prod
FROM base as prod
ARG STRATO_VERSION
ENV STRATO_VERSION=${STRATO_VERSION}
COPY docker-run.sh /usr/src/app
COPY --from=builder /usr/src/app/build build/
EXPOSE 3002
HEALTHCHECK --interval=5s --timeout=2s --start-period=180s \
  CMD lsof -i :3002 || \
    exit 1
CMD [ "sh", "/usr/src/app/docker-run.sh" ]

### Test
FROM base as test
COPY . /usr/src/app
COPY --from=npminstaller /usr/src/app/node_modules /usr/src/app/node_modules/
RUN npm install
RUN npm test
