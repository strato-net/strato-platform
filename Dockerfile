FROM bloc-deploybase:latest
COPY ./ /
ENTRYPOINT ["/usr/bin/bloc/doit.sh"]
