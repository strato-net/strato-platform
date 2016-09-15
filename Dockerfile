FROM node:6.5.0

RUN useradd --user-group --create-home --shell /bin/false app

ENV HOME=/home/app

COPY package.json npm-shrinkwrap.json $HOME/cirrus/
RUN chown -R app:app $HOME/*

USER app
WORKDIR $HOME/cirrus
RUN npm install

USER root
COPY . $HOME/cirrus
COPY lib $HOME/cirrus/lib
RUN chown -R app:app $HOME/*
USER app

CMD ["node", "cirrus.js"]

