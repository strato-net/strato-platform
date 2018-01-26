FROM node:boron-slim

RUN mkdir -p /usr/src/app && \
    npm install -g serve

WORKDIR /usr/src/app

COPY . /usr/src/app

RUN npm install && \
    npm run build && \
    rm -rf node_modules public src

EXPOSE 3000

CMD [ "sh", "/usr/src/app/docker-run.sh" ]