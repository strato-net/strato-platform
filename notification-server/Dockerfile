FROM node:18-alpine3.17

RUN apk add --no-cache yarn curl git lsof && \
    mkdir -p /usr/src/notification-server

HEALTHCHECK --interval=3s --timeout=2s --start-period=300s \
  CMD lsof -i :8019 || \
  exit 1

COPY . /usr/src/notification-server

WORKDIR /usr/src/notification-server

RUN yarn install

EXPOSE 8019

CMD [ "sh", "/usr/src/notification-server/docker-run.sh" ]
