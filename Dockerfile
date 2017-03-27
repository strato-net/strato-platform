FROM strato-deploybase:latest
COPY ./ /
ENTRYPOINT ["/var/lib/doit.sh"]
