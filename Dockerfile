FROM ubuntu:16.04
MAINTAINER Ilya Ostrovskiy <ilya@blockapps.net>

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install -y nginx && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* && \
    mkdir -p /etc/nginx

COPY nginx-nossl.conf nginx-ssl.conf /etc/nginx/
COPY run.sh /
RUN chmod a+x /run.sh

ENTRYPOINT ["/run.sh"]
