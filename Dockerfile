FROM node:6.3.1

WORKDIR /src

COPY . /src

RUN npm install
RUN npm install -g serve

CMD /bin/bash ./run.sh
