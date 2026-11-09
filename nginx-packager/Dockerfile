# Lua libraries are installed with luarocks, which only the fat image ships;
# the runtime image is the slim one with the installed tree copied over.
# Each rock is pinned by version and sha256 and installed without dependency
# resolution: lua-resty-openssl comes from OpenResty's own lualib.
FROM openresty/openresty:1.31.8.1-0-alpine-fat AS lua
WORKDIR /rocks
RUN for r in lua-resty-openidc-1.7.6-3 lua-resty-session-3.10-1 lua-resty-jwt-0.4.0-1 \
             lua-resty-http-0.18.0-0 nginx-lua-prometheus-0.20260912-1; do \
      curl -fsSLO "https://raw.githubusercontent.com/rocks-moonscript-org/moonrocks-mirror/2260fc22e57099c9f09f4c85f375e931946dcbe1/$r.src.rock" || exit 1; \
    done && \
    printf '%s\n' \
      '92c284444b9ba4acc3ff2ca194312428df4004284c1ea2af690de1e9395d67b7  lua-resty-openidc-1.7.6-3.src.rock' \
      'afd379378d701fac99e04b7e21911a37f23b037139a842a26058d1c0c050380e  lua-resty-session-3.10-1.src.rock' \
      '8662b0b142899e9e3e3d04edf7c189a46aff13f1b4bd87180d16e8fcfd9e1e45  lua-resty-jwt-0.4.0-1.src.rock' \
      '9059fb963c1db4a2328b65307f5b09fd0decfa414da7bf842d95795e845d6827  lua-resty-http-0.18.0-0.src.rock' \
      '033a455058cbe5a3abc335b7e850d6b0167bc45312575a4e083805546612f45e  nginx-lua-prometheus-0.20260912-1.src.rock' \
      | sha256sum -c - && \
    for f in *.src.rock; do luarocks --tree /lua install --deps-mode none "$f" || exit 1; done

FROM openresty/openresty:1.31.8.1-0-alpine-slim
LABEL maintainer="BlockApps Inc."

RUN apk add --no-cache bash curl jq yq && \
    mkdir -p /usr/local/openresty/nginx/lua && \
    rm /usr/local/openresty/nginx/conf/nginx.conf

COPY --from=lua /lua/share/lua/5.1/ /usr/local/openresty/luajit/share/lua/5.1/

COPY nginx.tpl.conf openid.tpl.lua vault-openid.tpl.lua csrf.lua rpc-guard.lua tracing.lua /tmp/

COPY swagger/ /usr/local/openresty/nginx/html/swagger/

COPY docker-run.sh /

COPY licenses /licenses

ENTRYPOINT ["/docker-run.sh"]
