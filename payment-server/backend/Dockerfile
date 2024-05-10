FROM node:14.21.3-alpine3.17

RUN apk add --no-cache yarn curl git lsof && \
    mkdir -p /usr/src/payment-server

HEALTHCHECK --interval=3s --timeout=2s --start-period=300s \
  CMD lsof -i :8018 || \
  exit 1

COPY . /usr/src/payment-server/backend

WORKDIR /usr/src/payment-server/backend

RUN yarn install

EXPOSE 8018

CMD [ "sh", "/usr/src/payment-server/docker-run.sh" ]
