FROM openresty/openresty:1.21.4.4-1-alpine-fat
LABEL maintainer="BlockApps Inc."

RUN apk add bash apache2-utils vim nano bind-tools jq && \
    mkdir -p /usr/local/openresty/nginx/lua && \
    wget -P /usr/local/openresty/nginx/lua https://raw.githubusercontent.com/knyar/nginx-lua-prometheus/0.20181120/prometheus.lua && \
    rm /usr/local/openresty/nginx/conf/nginx.conf && \
    luarocks install lua-resty-openidc 1.7.6 --only-server https://raw.githubusercontent.com/rocks-moonscript-org/moonrocks-mirror/daab2726276e3282dc347b89a42a5107c3500567
    # The --only-server url added to avoid the error in luarocks: "main function has more than 65536 constants"

HEALTHCHECK --interval=5s --timeout=1s --start-period=180s \
  CMD curl  --silent --output /dev/null --fail localhost:80/_ping || \
        exit 1

COPY nginx.tpl.conf openid.tpl.lua /tmp/

COPY docker-run.sh /

COPY licenses /licenses

ENTRYPOINT ["/docker-run.sh"]
