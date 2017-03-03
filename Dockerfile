FROM ubuntu:16.04
MAINTAINER Ilya Ostrovskiy <ilya@blockapps.net>
ENV POSTGREST_SOURCE=http://github.com/begriffs/postgrest/releases/download
ENV POSTGREST_VERSION=0.3.2.0
ENV POSTGREST_FILE=postgrest-$POSTGREST_VERSION-ubuntu.tar.xz
ENV POSTGREST_SCHEMA=public
ENV POSTGREST_ANONYMOUS=postgres
ENV POSTGREST_JWT_SECRET=thisisnotarealsecret
ENV POSTGREST_MAX_ROWS=1000000
ENV POSTGREST_POOL=200
ENV DOCKERIZE_SOURCE=https://github.com/jwilder/dockerize/releases/download/
ENV DOCKERIZE_VERSION=v0.1.0
ENV DOCKERIZE_FILE=dockerize-linux-amd64-$DOCKERIZE_VERSION.tar.gz
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update                                                        && \
    apt-get install -y tar xz-utils wget libpq-dev netcat-openbsd netbase && \
    apt-get clean                                                         && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*
RUN wget "$POSTGREST_SOURCE/v$POSTGREST_VERSION/$POSTGREST_FILE" && \
    tar xvJf $POSTGREST_FILE                                     && \
    mv postgrest /usr/local/bin/postgrest                        && \
    rm $POSTGREST_FILE
RUN wget "$DOCKERIZE_SOURCE/$DOCKERIZE_VERSION/$DOCKERIZE_FILE"  && \
    tar -C /usr/local/bin -xvzf $DOCKERIZE_FILE
COPY doit.sh /doit.sh
ENTRYPOINT ["/doit.sh"]
