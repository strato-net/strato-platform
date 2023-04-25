FROM node:16-bullseye-slim
RUN apt-get update && \
    apt-get install -y git postgresql-client python3 build-essential && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* && \
    mkdir -p /usr/src/app
    # postgres-client is required for pgtools module; also used for container health check
    # Same layer is also used in smd image to avoid duplication and lower the build time. Todo: use shared base
WORKDIR /usr/src/app
EXPOSE 3009
COPY package*.json  /usr/src/app/
RUN npm install
COPY . /usr/src/app
ARG STRATO_VERSION
ENV STRATO_VERSION=${STRATO_VERSION}
CMD [ "bash", "-c", "/usr/src/app/docker-run.sh" ]
