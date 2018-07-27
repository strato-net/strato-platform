FROM ubuntu:16.04

COPY ./ /

EXPOSE 8000

HEALTHCHECK --interval=5s --timeout=1s --start-period=20s \
  CMD curl  --silent --output /dev/null --fail localhost:8000/_ping || exit 1

ENTRYPOINT ["/usr/bin/oauth/doit.sh"]
