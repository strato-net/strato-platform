FROM node:14.21.3-alpine3.17

RUN apk add --no-cache yarn curl git lsof && \
    mkdir -p /usr/src/backend

HEALTHCHECK --interval=3s --timeout=2s --start-period=300s \
  CMD lsof -i :3030 || \
  exit 1

COPY . /usr/src/backend/

WORKDIR /usr/src/backend

RUN yarn build-barest && yarn install

CMD [ "sh", "/usr/src/backend/docker-run.sh" ]
