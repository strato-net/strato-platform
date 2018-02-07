FROM bloch-deploybase:latest

COPY ./ /

# 8002 is for strato-api swagger.json, see nginx.conf in blockapps/nginx-packager
EXPOSE 8000 8002

ENTRYPOINT ["/usr/bin/bloc/doit.sh"]
