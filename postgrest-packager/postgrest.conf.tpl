db-uri = "postgres://${PG_ENV_POSTGRES_USER}:${PG_ENV_POSTGRES_PASSWORD}@${PG_ENV_POSTGRES_HOST}:${PG_PORT_5432_TCP_PORT}/${PG_ENV_POSTGRES_DB}"
db-schema = "${POSTGREST_SCHEMA}"
db-anon-role = "${POSTGREST_ANONYMOUS}"
db-pool = ${POSTGREST_POOL}

server-host = "*4"
server-port = ${POSTGREST_LISTEN_PORT}

log-level = "${POSTGREST_LOG_LEVEL}"

## base url for swagger output
# server-proxy-uri = ""

## choose a secret to enable JWT auth
## (use "@filename" to load from separate file)
jwt-secret = "${POSTGREST_JWT_SECRET}"
secret-is-base64 = false

## limit rows in response
max-rows = ${POSTGREST_MAX_ROWS}

## stored proc to exec immediately after auth
# pre-request = "stored_proc_name"

# allow aggregate queries
db-aggregates-enabled = true
statement_timeout = 5
