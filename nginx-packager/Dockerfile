FROM openresty/openresty:1.13.6.1-xenial
MAINTAINER BlockApps Inc.

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install -y apache2-utils curl wget vim nano && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* && \
    mkdir -p /usr/local/openresty/nginx/lua && \
    wget -P /usr/local/openresty/nginx/lua https://raw.githubusercontent.com/knyar/nginx-lua-prometheus/0.20181120/prometheus.lua && \
    rm /usr/local/openresty/nginx/conf/nginx.conf && \
    opm get zmartzone/lua-resty-openidc=1.7.1

HEALTHCHECK --interval=5s --timeout=1s --start-period=180s \
  CMD curl  --silent --output /dev/null --fail localhost:80/_ping || \
        exit 1

COPY nginx.tpl.conf auth.htpasswd openid.tpl.lua /tmp/

COPY docker-run.sh /

COPY licenses /licenses

ENTRYPOINT ["/docker-run.sh"]
