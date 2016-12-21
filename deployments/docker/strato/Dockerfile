FROM auth.blockapps.net:5000/blockapps/solc
MAINTAINER Ryan Reich <ryan@blockapps.net>

RUN export DEBIAN_FRONTEND=noninteractive; \
    sed -i 's/httpredir/ftp.us/' /etc/apt/sources.list; \
    apt-get clean; \
    apt-get update; \
    apt-get -y install curl

RUN curl -sL https://deb.nodesource.com/setup_6.x | bash -

RUN export DEBIAN_FRONTEND=noninteractive;  \
    apt-get update; \
    apt-get -y install software-properties-common; \
    add-apt-repository ppa:ethereum/ethereum;  \
    apt-get update; \
    apt-get -y install solc netcat libleveldb-dev libpq-dev libpcre3-dev netbase nodejs;

RUN mkdir -p /var/lib/strato

WORKDIR /var/lib/strato

RUN npm install blockapps-js yaml-parser

COPY bin/* /usr/bin/
COPY launch-strato.sh /usr/bin
COPY kafka-topics.sh mkCoinbase genesis/* /var/lib/strato/

VOLUME /var/lib/strato
ENTRYPOINT ["/usr/bin/launch-strato.sh"]

