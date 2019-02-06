FROM blockapps-deploybase:latest

EXPOSE 8000

HEALTHCHECK --interval=5s --timeout=1s --start-period=20s \
  CMD curl  --silent --output /dev/null --fail localhost:8000/strato/v2.3/_ping || exit 1

COPY ./ /

ENTRYPOINT ["/doit.sh"]
