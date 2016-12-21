FROM node:5.12.0-slim
MAINTAINER Ryan Reich <ryan@blockapps.net>
RUN export DEBIAN_FRONTEND=noninteractive;\
sed -i 's/httpredir/ftp.us/' /etc/apt/sources.list; \
apt-get clean; \
apt-get update; \
apt-get install -y git build-essential
COPY bloc /usr/lib/strato/bloc-server
RUN rm -rf /usr/lib/strato/bloc-server/.git{,attributes,ignore}
# RUN groupadd -r blocusers && useradd -r -g blocusers blocuser; \
#      mkdir -m 755 /home/blocuser
# USER blocuser
RUN cd /usr/lib/strato/bloc-server; npm install --quiet
RUN mkdir -p /var/run/strato; cd /var/run/strato; \
/usr/lib/strato/bloc-server/bin/main.js init --optIn --appName bloc-server --developer explorer --apiURL 'http://%APIURL%';\
cd bloc-server; \
npm install --quiet; \
ls; \
node_modules/bower/bin/bower install --allow-root
COPY startup.sh /usr/bin
ENTRYPOINT ["/usr/bin/startup.sh"]
EXPOSE 8000
VOLUME /var/run/strato
