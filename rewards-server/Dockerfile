FROM node:21-alpine3.20

RUN apk add --no-cache curl git lsof && \
    mkdir -p /usr/src/rewards-server

#HEALTHCHECK --interval=3s --timeout=2s --start-period=300s \
#  CMD lsof -i :3000 || \
#  exit 1

COPY . /usr/src/rewards-server

WORKDIR /usr/src/rewards-server

RUN npm install

#EXPOSE 3000 # None at the moment

CMD [ "npm", "run", "start" ]
