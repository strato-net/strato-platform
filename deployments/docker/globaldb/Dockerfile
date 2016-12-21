FROM ubuntu
MAINTAINER Ryan Reich <ryan@blockapps.net>

RUN export DEBIAN_FRONTEND=noninteractive; \
    sed -i 's/httpredir/ftp.us/' /etc/apt/sources.list; \
    apt-get clean; \
    apt-get update; \
    apt-get -y install libpq-dev libleveldb-dev netcat;

COPY global-db.sh bin/global-db /usr/bin/

ENTRYPOINT ["/usr/bin/global-db.sh"]
