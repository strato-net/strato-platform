FROM node:21.7.1-alpine3.19

RUN apk add --no-cache yarn curl git lsof jq && \
    mkdir -p /usr/src/backend

HEALTHCHECK --interval=3s --timeout=2s --start-period=300s \
  CMD lsof -i :3030 || \
  exit 1

COPY . /usr/src/backend/

WORKDIR /usr/src/backend

ENV NODE_ENV=production

RUN yarn install --frozen-lockfile --prod

CMD [ "sh", "/usr/src/backend/docker-run.sh" ]
