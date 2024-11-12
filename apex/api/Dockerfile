FROM node:21.7.1-alpine3.19
ARG STRATO_VERSION
ENV STRATO_VERSION=${STRATO_VERSION}
RUN apk add --no-cache postgresql-client curl lsof && \
    mkdir -p /usr/src/app
    # postgres-client is required for pgtools module
WORKDIR /usr/src/app
EXPOSE 3009
HEALTHCHECK --interval=5s --timeout=2s --start-period=180s \
  CMD lsof -i :3009 || \
    exit 1
COPY package*.json  /usr/src/app/
ENV NODE_ENV=production
RUN npm ci --only=production
COPY . /usr/src/app
CMD [ "sh", "-c", "/usr/src/app/docker-run.sh" ]
