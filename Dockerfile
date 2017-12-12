FROM node:6.10.0-alpine

MAINTAINER BlockApps Inc.

RUN echo 'http://dl-cdn.alpinelinux.org/alpine/v3.5/main/' > /etc/apk/repositories && \
    apk upgrade --no-cache && \
    apk add --no-cache curl

COPY *.js package.json /usr/lib/cirrus/

COPY lib/* /usr/lib/cirrus/lib/

RUN cd /usr/lib/cirrus && \
    npm install

COPY doit.sh /

ENTRYPOINT ["sh", "/doit.sh"]
