FROM node:slim
MAINTAINER Ryan Reich <ryan@blockapps.net>

RUN export DEBIAN_FRONTEND=noninteractive;\
sed -i 's/httpredir/ftp.us/' /etc/apt/sources.list; \
apt-get clean; \
apt-get update; \
apt-get install -y git python build-essential;
RUN npm install --quiet -g bower grunt-cli

COPY explorer /usr/lib/strato/explorer

RUN rm -rf /usr/lib/strato/explorer/.git{,attributes,ignore}
RUN cd /usr/lib/strato/explorer; \
npm install --quiet; \
bower --allow-root install; \
grunt build;

COPY startup.sh /usr/bin

ENTRYPOINT ["/usr/bin/startup.sh"]
EXPOSE 9000
