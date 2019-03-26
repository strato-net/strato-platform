FROM node:9-stretch

RUN apt-get update && \
    mkdir -p /usr/share/man/man1 /usr/share/man/man7 && \
    apt-get install -y git postgresql-client zip && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* && \
    mkdir -p /usr/src/app
# /usr/share/man/ required for postgres-client on debian slim
# postgres-client is required for pgtools module; also used for container health check

WORKDIR /usr/src/app

EXPOSE 3001

VOLUME /usr/src/app/apps

COPY package*.json  /usr/src/app/

RUN npm install

COPY . /usr/src/app

CMD [ "sh", "/usr/src/app/docker-run.sh" ]
