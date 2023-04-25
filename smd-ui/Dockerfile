FROM node:8.16-buster-slim
RUN apt-get update && \
    apt-get install -y git postgresql-client python3 build-essential curl && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* && \
    mkdir -p /usr/src/app
    
ARG STRATO_VERSION
ENV STRATO_VERSION=${STRATO_VERSION}
RUN npm install -g serve@11.3.2
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
COPY docker-run.sh /usr/src/app
COPY --from=builder /usr/src/app/build .
EXPOSE 3002
CMD [ "sh", "/usr/src/app/docker-run.sh" ]

### Test
FROM base as test
COPY . /usr/src/app
COPY --from=npminstaller /usr/src/app/node_modules /usr/src/app
RUN npm install
RUN npm test
