FROM postgres:14.18

ENV POSTGRES_USER=strato_admin POSTGRES_DB=eth

COPY init-permissions.sql /docker-entrypoint-initdb.d/10-runtime-permissions.sql
COPY pg_hba.conf /etc/postgresql/pg_hba.conf
RUN chmod 644 /docker-entrypoint-initdb.d/10-runtime-permissions.sql /etc/postgresql/pg_hba.conf

CMD ["postgres", "-c", "hba_file=/etc/postgresql/pg_hba.conf"]
