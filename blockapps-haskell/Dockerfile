FROM bloch-deploybase:latest

COPY ./ /

# 8002 is for strato-api swagger.json, see nginx conf in blockapps/nginx-packager
EXPOSE 8000 8002

HEALTHCHECK --interval=5s --timeout=1s --start-period=20s \
  CMD curl  --silent --output /dev/null --fail localhost:8000/bloc/v2.2/ && \
        pgrep slipstream && \
        curl  --silent --output /dev/null --fail localhost:8002/swagger.json || \
        exit 1

ENTRYPOINT ["/usr/bin/bloc/doit.sh"]
