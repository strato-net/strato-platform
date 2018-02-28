FROM node:9.6.1

RUN apt-get update && \
    apt-get install -y git postgresql-client zip && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* && \
    mkdir -p /usr/src/app

WORKDIR /usr/src/app

COPY package.json /usr/src/app/

RUN npm install

COPY . /usr/src/app

EXPOSE 3001

VOLUME /usr/src/app/apps

CMD [ "sh", "/usr/src/app/docker-run.sh" ]
