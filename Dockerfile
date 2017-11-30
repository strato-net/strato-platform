FROM node:6.10.0-alpine
MAINTAINER BlockApps Inc.

COPY *.js package.json lib /usr/lib/strato/cirrus/
RUN cd /usr/lib/strato/cirrus                                 && \
    npm set progress=false                                    && \
    npm install --quiet
USER root
COPY doit.sh /

ENTRYPOINT ["/doit.sh"]
