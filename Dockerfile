FROM strato-deploybase:latest
COPY ./ /
ENTRYPOINT ["/doit.sh"]
