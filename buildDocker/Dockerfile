
FROM ubuntu

COPY package.deb /

RUN apt-get update && apt-get install -y gdebi-core

RUN gdebi -n package.deb

ENV PATH="${PATH}:/root/.local/bin"
