FROM node:18.18-alpine3.18
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
RUN npm install
COPY . /usr/src/app
CMD [ "sh", "-c", "/usr/src/app/docker-run.sh" ]
