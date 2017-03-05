FROM node:6.10.0-alpine
MAINTAINER Ilya Ostrovskiy <ilya@blockapps.net>
# Be assholes and bump alpine versions the hard way.
RUN echo 'http://dl-cdn.alpinelinux.org/alpine/v3.5/main/' > /etc/apk/repositories
RUN echo 'http://dl-cdn.alpinelinux.org/alpine/v3.5/community/' >> /etc/apk/repositories
RUN apk upgrade --no-cache
RUN mkdir -p /usr/lib/strato/cirrus/lib 
COPY package.json npm-shrinkwrap.json /usr/lib/strato/cirrus/
COPY *.js /usr/lib/strato/cirrus/
COPY nginx /usr/lib/strato/cirrus/.
COPY lib/* /usr/lib/strato/cirrus/lib/
RUN mkdir -p /var/run/strato/cirrus 
ENV APKS="bash git python alpine-sdk nasm autoconf automake zlib zlib-dev curl"
RUN apk add --no-cache $APKS                                  && \
    cd /usr/lib/strato/cirrus                                 && \
    npm set progress=false                                    && \
    npm install --quiet                                       
   # apk del $APKS
USER root
#RUN curl -sL https://deb.nodesource.com/setup_6.x
#RUN apk add --no-cache nodejs
#RUN addgroup -S app
#RUN adduser -S -G app -s /bin/false -h /home/app app
#ENV HOME=/home/app
#COPY package.json npm-shrinkwrap.json $HOME/cirrus/
#COPY . $HOME/cirrus
#COPY lib $HOME/cirrus/lib
COPY doit.sh /
#RUN chown -R app:app $HOME/*
#RUN chown -R app:app /usr/lib/strato/cirrus
#RUN chown -R app:app /var/run/strato
#RUN chown -R app:app /doit.sh
#USER app

ENTRYPOINT ["/doit.sh"]
