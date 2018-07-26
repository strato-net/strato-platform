FROM ubuntu:16.04

COPY ./ /

EXPOSE 8000

# HEALTHCHECK --interval=10s --timeout=1s --start-period=20s \
#   CMD curl  --silent --output /dev/null --fail localhost:9000/strato/v2.3/ && \
#         exit 1

ENTRYPOINT ["/usr/bin/oauth/doit.sh"]
