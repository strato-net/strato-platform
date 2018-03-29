FROM node:9-slim

RUN apt-get update && \
    apt-get install -y git postgresql-client zip && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* && \
    mkdir -p /usr/src/app

WORKDIR /usr/src/app

COPY package.json /usr/src/app/

RUN npm install

# TODO: remove after https://github.com/blockapps/blockapps-rest/pull/62 is published to NPM
RUN sed -i 's/txResult.msg/txResult.message/' node_modules/blockapps-rest/lib/rest_5.js

COPY . /usr/src/app

EXPOSE 3001

VOLUME /usr/src/app/apps

CMD [ "sh", "/usr/src/app/docker-run.sh" ]
