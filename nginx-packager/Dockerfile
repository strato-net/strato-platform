# Lua libraries are installed with luarocks, which only the fat image ships;
# the runtime image is the slim one with the installed tree copied over.
FROM openresty/openresty:1.31.8.1-0-alpine-fat AS lua
RUN luarocks install lua-resty-openidc 1.7.6 --only-server https://raw.githubusercontent.com/rocks-moonscript-org/moonrocks-mirror/daab2726276e3282dc347b89a42a5107c3500567
    # The --only-server url added to avoid the error in luarocks: "main function has more than 65536 constants"

FROM openresty/openresty:1.31.8.1-0-alpine-slim
LABEL maintainer="BlockApps Inc."

RUN apk add --no-cache bash curl jq yq && \
    mkdir -p /usr/local/openresty/nginx/lua && \
    wget -P /usr/local/openresty/nginx/lua https://raw.githubusercontent.com/knyar/nginx-lua-prometheus/0.20181120/prometheus.lua && \
    rm /usr/local/openresty/nginx/conf/nginx.conf

COPY --from=lua /usr/local/openresty/luajit/share/lua/5.1/ /usr/local/openresty/luajit/share/lua/5.1/

COPY nginx.tpl.conf openid.tpl.lua vault-openid.tpl.lua csrf.lua rpc-guard.lua tracing.lua /tmp/

COPY swagger/ /usr/local/openresty/nginx/html/swagger/

COPY docker-run.sh /

COPY licenses /licenses

ENTRYPOINT ["/docker-run.sh"]
