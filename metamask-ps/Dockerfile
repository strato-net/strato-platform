FROM node:14.21.3-alpine3.17

RUN apk add --no-cache yarn curl git lsof && \
    mkdir -p /usr/src/metamask-ps

HEALTHCHECK --interval=3s --timeout=2s --start-period=300s \
  CMD lsof -i :8019 || \
  exit 1

COPY . /usr/src/metamask-ps/

WORKDIR /usr/src/metamask-ps

RUN yarn install

COPY /usr/src/metamask-ps/node_modules/@metamask/dist/metamask-onboarding.js /usr/src/metamask-ps/public

EXPOSE 8019

CMD [ "sh", "/usr/src/metamask-ps/docker-run.sh" ]
