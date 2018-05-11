FROM openresty/openresty:1.13.6.1-xenial
MAINTAINER BlockApps Inc.

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install -y apache2-utils curl && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* && \
    mkdir -p /usr/local/openresty/nginx/lua

COPY azure-nginx-nonssl.conf azure-nginx-ssl.conf nginx-nonssl.conf nginx-ssl.conf auth.htpasswd azure-authentication.lua /tmp/

COPY docker-run.sh /

RUN chmod a+x /docker-run.sh

ENTRYPOINT ["/docker-run.sh"]