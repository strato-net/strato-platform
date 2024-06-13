FROM openresty/openresty:1.19.3.1-7-buster
MAINTAINER BlockApps Inc.

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install -y apache2-utils curl wget vim nano openresty-opm dnsutils && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* && \
    rm /usr/local/openresty/nginx/conf/nginx.conf

HEALTHCHECK --interval=5s --timeout=1s --start-period=180s \
  CMD curl  --silent --output /dev/null --fail localhost:4444/_ping || \
        exit 1

COPY nginx.tpl.conf /tmp/

COPY docker-run.sh /

ENTRYPOINT ["/docker-run.sh"]
