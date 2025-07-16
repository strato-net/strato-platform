FROM node:21-alpine3.20

RUN apk add --no-cache curl git lsof && \
    mkdir -p /usr/src/eth-bridge

# TODO: No port to monitor yet, only the WS
#HEALTHCHECK --interval=3s --timeout=2s --start-period=300s \
#  CMD lsof -i :3000 || \
#  exit 1

COPY . /usr/src/eth-bridge

WORKDIR /usr/src/eth-bridge

RUN npm install

EXPOSE 443 80

CMD [ "npm", "run", "start" ]
