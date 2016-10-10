FROM debian:jessie

ENV POSTGREST_VERSION 0.3.2.0
ENV POSTGREST_SCHEMA public
ENV POSTGREST_ANONYMOUS postgres
ENV POSTGREST_JWT_SECRET thisisnotarealsecret
ENV POSTGREST_MAX_ROWS 1000000
ENV POSTGREST_POOL 200

RUN apt-get update && \
    apt-get install -y tar xz-utils wget libpq-dev && \
    apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

RUN wget http://github.com/begriffs/postgrest/releases/download/v${POSTGREST_VERSION}/postgrest-${POSTGREST_VERSION}-ubuntu.tar.xz && \
    tar --xz -xvf postgrest-${POSTGREST_VERSION}-ubuntu.tar.xz && \
    mv postgrest /usr/local/bin/postgrest && \
    rm postgrest-${POSTGREST_VERSION}-ubuntu.tar.xz

RUN apt-get update && apt-get install -y wget
RUN wget https://github.com/jwilder/dockerize/releases/download/v0.1.0/dockerize-linux-amd64-v0.1.0.tar.gz
RUN tar -C /usr/local/bin -xzvf dockerize-linux-amd64-v0.1.0.tar.gz

ENV PG_PORT_5433_TCP_PORT 5432
ENV PG_ENV_POSTGRES_DB cirrus

CMD exec postgrest postgres://postgres:${PG_ENV_POSTGRES_PASSWORD}@postgres:${PG_PORT_5433_TCP_PORT}/${PG_ENV_POSTGRES_DB} \
              --port 3000 \
              --schema ${POSTGREST_SCHEMA} \
              --anonymous ${POSTGREST_ANONYMOUS} \
              --pool ${POSTGREST_POOL} \
              --jwt-secret ${POSTGREST_JWT_SECRET} \
              --max-rows ${POSTGREST_MAX_ROWS}

ENV CONNECTIONSTRING postgres:${PG_ENV_POSTGRES_PASSWORD}@postgres:${PG_PORT_5433_TCP_PORT}/${PG_ENV_POSTGRES_DB}

COPY wait-for-it.sh wait-for-it.sh
COPY wait-for-postgres.sh wait-for-postgres.sh

EXPOSE 3001
