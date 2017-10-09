FROM bloch-deploybase:latest
COPY ./ /
EXPOSE 8000
ENTRYPOINT ["/usr/bin/bloc/doit.sh"]
