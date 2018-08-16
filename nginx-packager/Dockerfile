FROM openresty/openresty:1.13.6.1-xenial
MAINTAINER BlockApps Inc.

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install -y apache2-utils curl && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* && \
    mkdir -p /usr/local/openresty/nginx/lua && \
    rm /usr/local/openresty/nginx/conf/nginx.conf && \
    opm get zmartzone/lua-resty-openidc

COPY nginx.tpl.conf auth.htpasswd openid-auth.tpl.lua /tmp/

COPY docker-run.sh /

COPY licenses /licenses

RUN chmod a+x /docker-run.sh

ENTRYPOINT ["/docker-run.sh"]
