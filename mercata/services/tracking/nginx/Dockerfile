FROM openresty/openresty:1.21.4.4-1-alpine-fat
LABEL maintainer="BlockApps Inc."

RUN apk add bash curl && \
    rm /usr/local/openresty/nginx/conf/nginx.conf

HEALTHCHECK --interval=5s --timeout=1s --start-period=180s \
  CMD curl --silent --output /dev/null --fail localhost:80/_ping || \
        exit 1

COPY nginx.tpl.conf /tmp/

COPY docker-run.sh /

RUN chmod +x /docker-run.sh

ENTRYPOINT ["/docker-run.sh"]
