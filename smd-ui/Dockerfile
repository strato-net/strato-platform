FROM node:boron-slim

RUN mkdir -p /usr/src/app && \
    npm install --verbose -g serve@6.5.3

WORKDIR /usr/src/app

COPY . /usr/src/app

RUN npm install && \
    npm run build && \
    rm -rf node_modules public src

EXPOSE 3002

CMD [ "sh", "/usr/src/app/docker-run.sh" ]
