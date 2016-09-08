
FROM ubuntu

COPY package.deb /

EXPOSE 1000-65535

RUN apt-get update && apt-get install -y gdebi-core

RUN gdebi -n package.deb

ENV PATH="${PATH}:/root/.local/bin"

ENTRYPOINT ["/doit.sh"]