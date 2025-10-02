FROM openresty/openresty:alpine

# Install additional dependencies including luarocks
RUN apk add --no-cache \
    lua-cjson \
    ca-certificates \
    openssl \
    git \
    gcc \
    musl-dev \
    luarocks5.1

# Install lua-resty-openidc using luarocks
RUN luarocks-5.1 install lua-resty-openidc

# Create directories for nginx
RUN mkdir -p /etc/nginx/conf.d /var/log/nginx /var/cache/nginx

# Copy nginx configuration
COPY nginx.conf /usr/local/openresty/nginx/conf/nginx.conf
COPY openid.lua /usr/local/openresty/nginx/conf/openid.lua

# Expose port 80
EXPOSE 80

# Start nginx
CMD ["/usr/local/openresty/bin/openresty", "-g", "daemon off;"]
