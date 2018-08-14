FROM ubuntu:16.04

RUN apt-get -y update                                          && \
    apt-get install -y curl libgmp-dev                         && \
    apt-get autoremove                                         && \
    rm -rf /var/lib/apt/lists/*                                && \
    apt-get clean

EXPOSE 8000

HEALTHCHECK --interval=5s --timeout=1s --start-period=20s \
  CMD curl  --silent --output /dev/null --fail localhost:8000/_ping || exit 1

COPY ./ /

ENTRYPOINT ["/usr/bin/doit.sh"]
