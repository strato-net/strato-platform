FROM node:6.10.0-alpine
MAINTAINER Ilya Ostrovskiy <ilya@blockapps.net>
# Be assholes and bump alpine versions the hard way.
RUN echo 'http://dl-cdn.alpinelinux.org/alpine/v3.5/main/' > /etc/apk/repositories
RUN echo 'http://dl-cdn.alpinelinux.org/alpine/v3.5/community/' >> /etc/apk/repositories
RUN apk upgrade --no-cache
ENV APKS="git python alpine-sdk nasm autoconf automake zlib zlib-dev"
RUN useradd --user-group --create-home --shell /bin/false app
ENV HOME=/home/app
COPY package.json npm-shrinkwrap.json $HOME/cirrus/
RUN chown -R app:app $HOME/*
RUN apk add --no-cache $APKS                                  && \
    npm set progress=false                                    && \
    npm install --quiet                                       && \
    node_modules/bower/bin/bower --allow-root --force install && \
    node_modules/grunt-cli/bin/grunt --env=nginx build        && \
    apk del $APKS

USER root
COPY . $HOME/cirrus
COPY lib $HOME/cirrus/lib
RUN chown -R app:app $HOME/*
USER app

#CMD ["node", "main.js"]
