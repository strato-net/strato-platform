FROM bloc-deploybase:latest
COPY ./ /
ENTRYPOINT ["/usr/local/bin/doit.sh"]
