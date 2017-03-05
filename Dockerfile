FROM strato-deploybase:latest
COPY ./ /
ENTRYPOINT ["/var/lib/strato/doit.sh"]
