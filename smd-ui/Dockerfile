FROM node:8.15-stretch-slim

ARG STRATO_VERSION

RUN mkdir -p /usr/src/app && \
    npm install -g serve@7.1.1

WORKDIR /usr/src/app

COPY . /usr/src/app

RUN npm install && \
    STRATO_VERSION=${STRATO_VERSION} npm run build && \
    rm -rf node_modules public src

EXPOSE 3002

CMD [ "sh", "/usr/src/app/docker-run.sh" ]
