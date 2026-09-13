#!/bin/bash
set -e

echo "=== STRATO Local Auth Starting ==="

# Read config from ethconf.yaml (single source of truth)
if [ ! -f /config/ethconf.yaml ]; then
    echo "ERROR: /config/ethconf.yaml not found. Ensure ethconf.yaml is mounted into the container."
    exit 1
fi
HTTP_PORT=$(yq '.networkConfig.httpPort' /config/ethconf.yaml)
NODE_URL=$(yq '.urlConfig.nodeUrl' /config/ethconf.yaml)
COOKIE_REALM=$(yq '.urlConfig.cookieRealm' /config/ethconf.yaml)

echo "Read from ethconf.yaml:"
echo "  httpPort: ${HTTP_PORT}"
echo "  nodeUrl: ${NODE_URL}"
echo "  cookieRealm: ${COOKIE_REALM}"

# The Postgres host comes from the DSN the node's compose provides: the
# postgres container on a monolith, or an external cluster's writer endpoint.
PG_HOST=$(printf '%s' "${DSN:-}" | sed -E 's#^[a-z]+://[^@]*@([^:/?]+).*$#\1#')
[ -n "$PG_HOST" ] && [ "$PG_HOST" != "${DSN:-}" ] || PG_HOST=postgres
PG_PORT=$(printf '%s' "${DSN:-}" | sed -nE 's#^[a-z]+://[^@]*@[^:/?]+:([0-9]+)/.*$#\1#p')
PG_PORT=${PG_PORT:-5432}
export PGHOST="$PG_HOST" PGPORT="$PG_PORT"
echo "  postgres: ${PG_HOST}:${PG_PORT}"

# Percent-encode a string for use inside a URL (the generated cluster
# passwords carry characters that libpq accepts raw but Kratos's URL parser
# does not). Dependency-free: byte by byte through od.
urlencode() {
    printf '%s' "$1" | od -An -tx1 -v | tr ' ' '\n' | grep -v '^$' | while read -r h; do
        c=$(printf "\\$(printf '%03o' "0x$h")")
        case "$c" in
            [A-Za-z0-9._~-]) printf '%s' "$c" ;;
            *) printf '%%%s' "$h" ;;
        esac
    done
}

# Read postgres password if available and update DSNs
if [ -f /run/secrets/postgres_password ]; then
    PGPASSWORD=$(cat /run/secrets/postgres_password)
    export PGPASSWORD
    PGPASSWORD_URL=$(urlencode "$PGPASSWORD")
    echo "Using postgres password from secrets"
    # Update DSN with password for Kratos
    if [ -n "$DSN" ]; then
        export DSN="postgres://postgres:${PGPASSWORD_URL}@${PG_HOST}:${PG_PORT}/kratos?sslmode=disable"
        echo "Updated Kratos DSN with password"
    fi
    # Update DSN with password for Hydra
    if [ -n "$HYDRA_DSN" ]; then
        export HYDRA_DSN="postgres://postgres:${PGPASSWORD_URL}@${PG_HOST}:${PG_PORT}/hydra?sslmode=disable"
        echo "Updated Hydra DSN with password"
    fi
else
    echo "No postgres password file found, using passwordless connection"
fi
# Kratos and Hydra read the DSN from their config files; write the resolved
# one there so the environment and the files agree on host and credentials.
[ -n "${DSN:-}" ] && sed -i "s|^dsn:.*|dsn: ${DSN}|" /etc/config/kratos.yml
[ -n "${HYDRA_DSN:-}" ] && sed -i "s|^dsn:.*|dsn: ${HYDRA_DSN}|" /etc/config/hydra.yml

read_secret_file() {
    local path="$1"
    local name="$2"
    if [ ! -f "$path" ]; then
        echo "ERROR: Missing required secret file: $path ($name)"
        exit 1
    fi
    tr -d '\r\n' < "$path"
}

escape_sed_replacement() {
    printf '%s' "$1" | sed -e 's/[\/&|]/\\&/g'
}

HYDRA_SYSTEM_SECRET=$(read_secret_file "/run/secrets/local_auth_hydra_system_secret" "HYDRA_SYSTEM_SECRET")
HYDRA_PAIRWISE_SALT=$(read_secret_file "/run/secrets/local_auth_hydra_pairwise_salt" "HYDRA_PAIRWISE_SALT")
KRATOS_COOKIE_SECRET=$(read_secret_file "/run/secrets/local_auth_kratos_cookie_secret" "KRATOS_COOKIE_SECRET")

HYDRA_SYSTEM_SECRET_ESCAPED=$(escape_sed_replacement "$HYDRA_SYSTEM_SECRET")
HYDRA_PAIRWISE_SALT_ESCAPED=$(escape_sed_replacement "$HYDRA_PAIRWISE_SALT")
KRATOS_COOKIE_SECRET_ESCAPED=$(escape_sed_replacement "$KRATOS_COOKIE_SECRET")

sed -i "s|__HYDRA_SYSTEM_SECRET__|${HYDRA_SYSTEM_SECRET_ESCAPED}|g" /etc/config/hydra.yml
sed -i "s|__HYDRA_PAIRWISE_SALT__|${HYDRA_PAIRWISE_SALT_ESCAPED}|g" /etc/config/hydra.yml
sed -i "s|__NODE_URL__|${NODE_URL}|g" /etc/config/hydra.yml
sed -i "s|__COOKIE_REALM__|${COOKIE_REALM}|g" /etc/config/hydra.yml
sed -i "s|__KRATOS_COOKIE_SECRET__|${KRATOS_COOKIE_SECRET_ESCAPED}|g" /etc/config/kratos.yml
sed -i "s|__NODE_URL__|${NODE_URL}|g" /etc/config/kratos.yml
sed -i "s|__COOKIE_REALM__|${COOKIE_REALM}|g" /etc/config/kratos.yml

# Function to wait for postgres
wait_for_postgres() {
    local max_attempts=30
    local attempt=1
    
    echo "Waiting for PostgreSQL to be ready..."
    while [ $attempt -le $max_attempts ]; do
        if pg_isready -h "$PG_HOST" -p "$PG_PORT" -U postgres > /dev/null 2>&1; then
            echo "PostgreSQL is ready!"
            return 0
        fi
        echo "  Attempt $attempt/$max_attempts - PostgreSQL not ready yet..."
        sleep 1
        attempt=$((attempt + 1))
    done
    
    echo "ERROR: PostgreSQL failed to start after $max_attempts attempts"
    return 1
}

# Function to wait for a service to be ready
wait_for_service() {
    local url=$1
    local name=$2
    local max_attempts=30
    local attempt=1
    
    echo "Waiting for $name to be ready..."
    while [ $attempt -le $max_attempts ]; do
        if curl -s "$url" > /dev/null 2>&1; then
            echo "$name is ready!"
            return 0
        fi
        echo "  Attempt $attempt/$max_attempts - $name not ready yet..."
        sleep 1
        attempt=$((attempt + 1))
    done
    
    echo "ERROR: $name failed to start after $max_attempts attempts"
    return 1
}

# Wait for postgres first
wait_for_postgres

# The identity and OAuth databases persist across restarts: created when
# missing, migrated in place (the migrations are idempotent). With
# LOCAL_AUTH_RESET=true they are dropped first, the old clean-slate behaviour.
echo "Setting up databases..."
if [ "${LOCAL_AUTH_RESET:-false}" = "true" ]; then
    echo "  LOCAL_AUTH_RESET: dropping kratos and hydra databases"
    psql -h "$PG_HOST" -p "$PG_PORT" -U postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('kratos', 'hydra') AND pid <> pg_backend_pid();" 2>/dev/null || true
    psql -h "$PG_HOST" -p "$PG_PORT" -U postgres -c "DROP DATABASE IF EXISTS kratos" && echo "    Done" || echo "    FAILED"
    psql -h "$PG_HOST" -p "$PG_PORT" -U postgres -c "DROP DATABASE IF EXISTS hydra" && echo "    Done" || echo "    FAILED"
fi
for db in kratos hydra; do
    if psql -h "$PG_HOST" -p "$PG_PORT" -U postgres -Atc "SELECT 1 FROM pg_database WHERE datname = '$db'" | grep -q 1; then
        echo "  $db database exists"
    else
        echo "  Creating $db database..."
        psql -h "$PG_HOST" -p "$PG_PORT" -U postgres -c "CREATE DATABASE $db" && echo "    Done" || echo "    FAILED"
    fi
done
echo "  Databases AFTER setup:"
psql -h "$PG_HOST" -p "$PG_PORT" -U postgres -c "SELECT datname FROM pg_database WHERE datistemplate = false;"
echo "  Checking hydra database is empty..."
psql -h "$PG_HOST" -p "$PG_PORT" -U postgres -d hydra -c "SELECT tablename FROM pg_tables WHERE schemaname = 'public';"

# Run migrations - must set DSN explicitly for each tool since -e reads from DSN env var
echo "Running Kratos migrations..."
DSN="$DSN" kratos migrate sql -e --yes --config /etc/config/kratos.yml

echo "Running Hydra migrations..."
DSN="$HYDRA_DSN" hydra migrate sql -e --yes --config /etc/config/hydra.yml

# Set login UI browser URL
export KRATOS_BROWSER_URL="${NODE_URL}/auth/kratos"

# Start supervisor in background temporarily to start services
/usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf &
SUPERVISOR_PID=$!

# Wait for services to be ready
wait_for_service "http://localhost:4433/health/ready" "Kratos"
wait_for_service "http://localhost:4444/health/ready" "Hydra"
wait_for_service "http://localhost:3000/health" "Login UI"

# Read OAuth client credentials from shared secrets file
OAUTH_CLIENT_ID="${OAUTH_CLIENT_ID:-strato-local}"
OAUTH_CLIENT_SECRET="${OAUTH_CLIENT_SECRET:-strato-local-secret}"
if [ -f /run/secrets/oauth_credentials.yaml ]; then
    OAUTH_CLIENT_ID=$(grep "clientId:" /run/secrets/oauth_credentials.yaml | cut -d'"' -f2)
    OAUTH_CLIENT_SECRET=$(grep "clientSecret:" /run/secrets/oauth_credentials.yaml | cut -d'"' -f2)
fi

# Create OAuth client in Hydra if it doesn't exist
echo "Creating default OAuth client..."
CLIENT_EXISTS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:4445/admin/clients/${OAUTH_CLIENT_ID}")
if [ "$CLIENT_EXISTS" != "200" ]; then
    curl -s -X POST "http://localhost:4445/admin/clients" \
        -H "Content-Type: application/json" \
        -d "{
            \"client_id\": \"${OAUTH_CLIENT_ID}\",
            \"client_secret\": \"${OAUTH_CLIENT_SECRET}\",
            \"grant_types\": [\"authorization_code\", \"refresh_token\", \"client_credentials\"],
            \"response_types\": [\"code\", \"token\", \"id_token\"],
            \"scope\": \"openid offline email profile\",
            \"redirect_uris\": [\"${NODE_URL}/auth/openidc/return\", \"http://localhost:${HTTP_PORT}/auth/openidc/return\", \"http://127.0.0.1:${HTTP_PORT}/auth/openidc/return\"],
            \"post_logout_redirect_uris\": [\"${NODE_URL}/\", \"http://localhost:${HTTP_PORT}/\", \"http://127.0.0.1:${HTTP_PORT}/\"],
            \"token_endpoint_auth_method\": \"client_secret_basic\"
        }" > /dev/null
    echo "OAuth client '${OAUTH_CLIENT_ID}' created."
else
    echo "OAuth client '${OAUTH_CLIENT_ID}' already exists."
fi

echo "Local auth admin user is created with strato-user-add."

echo ""
echo "=== STRATO Local Auth Ready ==="
echo ""
echo "Endpoints:"
echo "  Kratos Public:  http://localhost:4433"
echo "  Kratos Admin:   http://localhost:4434"
echo "  Hydra Public:   http://localhost:4444"
echo "  Hydra Admin:    http://localhost:4445"
echo "  Login UI:       http://localhost:3000"
echo ""
echo "OAuth Discovery:"
echo "  http://localhost:4444/.well-known/openid-configuration"
echo ""

# Keep supervisor running in foreground
wait $SUPERVISOR_PID
