FROM node:slim
MAINTAINER Ryan Reich <ryan@blockapps.net>

WORKDIR /usr/lib/strato
RUN npm install --quiet request bluebird
COPY streak /usr/lib/strato/

ENTRYPOINT ["/usr/lib/strato/streak"]

