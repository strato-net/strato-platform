FROM node:18-bookworm-slim
ARG STRATO_VERSION
ENV STRATO_VERSION=${STRATO_VERSION}
RUN apt-get update && \
    apt-get install -y postgresql-client curl && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* && \
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
CMD [ "bash", "-c", "/usr/src/app/docker-run.sh" ]
