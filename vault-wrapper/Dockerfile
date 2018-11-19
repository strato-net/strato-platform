FROM ubuntu:18.04

RUN apt-get -y update                                          && \
    apt-get install -y \
      curl \
      libgmp-dev \
      libsodium-dev \
      locales \
      postgresql-client \
                                                               && \
    apt-get autoremove                                         && \
    rm -rf /var/lib/apt/lists/*                                && \
    apt-get clean                                              && \
    locale-gen en_US.UTF-8

ENV LANG="en_US.UTF-8" \
    LANGUAGE="en_US:en" \
    LC_ALL="en_US.UTF-8"

EXPOSE 8000

HEALTHCHECK --interval=5s --timeout=1s --start-period=20s \
  CMD curl  --silent --output /dev/null --fail localhost:8000/strato/v2.3/_ping || exit 1

COPY ./ /

ENTRYPOINT ["/doit.sh"]
