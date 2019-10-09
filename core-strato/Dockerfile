FROM blockapps-deploybase:latest

RUN mkdir -p /var/lib/strato

COPY ./ /

EXPOSE 30303 30303/udp 3000

VOLUME /var/lib/strato

# Check ethereum-vm process is running (it is killed in container if one of the background processes crashed)
HEALTHCHECK --interval=5s --timeout=1s --start-period=20s \
  CMD pgrep vm-runner  || exit 1

ENTRYPOINT ["/var/lib/doit.sh"]
