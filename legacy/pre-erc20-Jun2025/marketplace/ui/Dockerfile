FROM node:21.7.1-alpine3.19 as base
RUN apk add --no-cache curl yarn git lsof jq && \
    yarn global add serve@13.0.2 && \
    mkdir -p /usr/src/ui
WORKDIR /usr/src/ui/

FROM base as yarninstaller
COPY package*.json /usr/src/ui/
COPY yarn.lock /usr/src/ui/
RUN yarn install --frozen-lockfile

### Builder
FROM yarninstaller as builder
COPY . /usr/src/ui/
RUN REACT_APP_IN_DOCKER=true REACT_APP_UI_VERSION=$(node -e "console.log(require('./package.json').version);") yarn build

### Prod
FROM base as prod
ENV NODE_ENV=production
COPY docker-run.sh /usr/src/ui/
COPY --from=builder /usr/src/ui/build build/
EXPOSE 3003
HEALTHCHECK --interval=3s --timeout=2s --start-period=300s \
  CMD lsof -i :3003 || \
    exit 1
CMD [ "sh", "/usr/src/ui/docker-run.sh" ]

### Test
FROM base as test
COPY . /usr/src/ui/
COPY --from=yarninstaller /usr/src/ui/node_modules /usr/src/ui/node_modules/
RUN yarn install --frozen-lockfile
RUN yarn test
