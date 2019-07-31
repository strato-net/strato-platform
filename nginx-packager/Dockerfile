FROM openresty/openresty:1.13.6.1-xenial
MAINTAINER BlockApps Inc.

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install -y apache2-utils curl && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* && \
    mkdir -p /usr/local/openresty/nginx/lua && \
    rm /usr/local/openresty/nginx/conf/nginx.conf && \
    opm get zmartzone/lua-resty-openidc=1.7.1 && \
    opm get nginx-lua-prometheus

HEALTHCHECK --interval=5s --timeout=1s --start-period=180s \
  CMD curl  --silent --output /dev/null --fail localhost:80/ || \
        exit 1

COPY nginx.tpl.conf auth.htpasswd openid.tpl.lua prometheus.tpl.lua /tmp/

COPY docker-run.sh /

COPY licenses /licenses

ENTRYPOINT ["/docker-run.sh"]
