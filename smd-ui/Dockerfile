FROM node:14-buster-slim
RUN apt-get update && \
    apt-get install -y git postgresql-client python build-essential && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* && \
    mkdir -p /usr/src/app \
    # Layer is shared with Apex. TODO: use shared base
ARG STRATO_VERSION
ENV STRATO_VERSION=${STRATO_VERSION}
RUN mkdir -p /usr/src/app && \
    npm install -g serve@11.3.2
WORKDIR /usr/src/app
COPY . /usr/src/app
RUN npm install && \
    npm run build && \
    rm -rf node_modules public src
EXPOSE 3002
CMD [ "sh", "/usr/src/app/docker-run.sh" ]
