FROM bloch-deploybase:latest
COPY ./ /
EXPOSE 8000 8002 # 8002 is for strato-api swagger.json, see nginx.conf in blockapps/nginx-packager
ENTRYPOINT ["/usr/bin/bloc/doit.sh"]
