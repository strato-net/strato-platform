FROM bloch-deploybase:latest
COPY ./ /
ENTRYPOINT ["/usr/bin/bloc/doit.sh"]
