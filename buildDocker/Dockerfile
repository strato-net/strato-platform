
FROM ubuntu

COPY package.deb /

run dpkg -i package.deb

ENV PATH="${PATH}:/root/.local/bin"
