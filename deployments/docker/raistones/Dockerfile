FROM node:5.9.0
MAINTAINER Ryan Reich <ryan@blockapps.net>

RUN \
  export DEBIAN_FRONTEND=noninteractive; \
  apt-get update; \
  apt-get -y install git python make g++ libpng12-dev pngquant;

COPY project-rai-stones /var/lib/project-rai-stones

WORKDIR /var/lib/project-rai-stones

RUN npm install --quiet
RUN npm run build:dll

ENTRYPOINT ["npm", "start"]
EXPOSE 3000
