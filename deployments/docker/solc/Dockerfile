FROM ubuntu:16.04
MAINTAINER Ryan Reich <ryan@blockapps.net>

COPY build /tmp
RUN /tmp/build
RUN rm /tmp/build

ENTRYPOINT ["/usr/local/bin/solc"]

