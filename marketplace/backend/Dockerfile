FROM node:14.21.3-alpine3.17

RUN apk add --no-cache yarn curl git lsof && \
    mkdir -p /usr/src/backend

HEALTHCHECK --interval=3s --timeout=2s --start-period=300s \
  CMD lsof -i :3030 || \
  exit 1

COPY . /usr/src/backend/

WORKDIR /usr/src/backend

# Temporary solution until the 8.3.1 is released - pegging to 8.1.0 for now
RUN sed -i '/file:..\/..\/blockapps-rest/c\"blockapps-rest": "8.1.0",' package.json

RUN yarn install

CMD [ "sh", "/usr/src/backend/docker-run.sh" ]
