FROM node:6.10.0-alpine
MAINTAINER Ilya Ostrovskiy <ilya@blockapps.net>
# Be assholes and bump alpine versions the hard way.
RUN echo 'http://dl-cdn.alpinelinux.org/alpine/v3.5/main/' > /etc/apk/repositories
RUN echo 'http://dl-cdn.alpinelinux.org/alpine/v3.5/community/' >> /etc/apk/repositories
RUN apk upgrade --no-cache
ENV APKS="git python alpine-sdk nasm autoconf automake zlib zlib-dev"
RUN apk add --no-cache $APKS                                  && \
    npm set progress=false                                    && \
    npm install --quiet                                       && \
    apk del $APKS

USER root
RUN addgroup -S app
RUN adduser -S -G app -s /bin/false -h /home/app app
ENV HOME=/home/app
COPY package.json npm-shrinkwrap.json $HOME/cirrus/
COPY . $HOME/cirrus
COPY lib $HOME/cirrus/lib
COPY doit.sh /
RUN chown -R app:app $HOME/*
USER app

ENTRYPOINT ["/doit.sh"]
#CMD ["node", "main.js"]
