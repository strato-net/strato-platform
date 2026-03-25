#!/bin/bash
set -e

echo "=== STRATO Local Auth Starting ==="

# Read postgres password if available and update DSNs
if [ -f /run/secrets/postgres_password ]; then
    PGPASSWORD=$(cat /run/secrets/postgres_password)
    export PGPASSWORD
    echo "Using postgres password from secrets"
    # Update DSN with password for Kratos
    if [ -n "$DSN" ]; then
        export DSN="postgres://postgres:${PGPASSWORD}@postgres:5432/kratos?sslmode=disable"
        echo "Updated Kratos DSN with password"
    fi
    # Update DSN with password for Hydra
    if [ -n "$HYDRA_DSN" ]; then
        export HYDRA_DSN="postgres://postgres:${PGPASSWORD}@postgres:5432/hydra?sslmode=disable"
        echo "Updated Hydra DSN with password"
    fi
else
    echo "No postgres password file found, using passwordless connection"
fi

# Function to wait for postgres
wait_for_postgres() {
    local max_attempts=30
    local attempt=1
    
    echo "Waiting for PostgreSQL to be ready..."
    while [ $attempt -le $max_attempts ]; do
        if pg_isready -h postgres -U postgres > /dev/null 2>&1; then
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

# For local dev, drop and recreate databases to ensure clean state
# This avoids migration conflicts from partial previous runs
echo "Setting up databases (dropping if exist for clean state)..."
echo "  Current databases BEFORE drop:"
psql -h postgres -U postgres -c "SELECT datname FROM pg_database WHERE datistemplate = false;"
echo "  Terminating connections to kratos/hydra databases..."
psql -h postgres -U postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('kratos', 'hydra') AND pid <> pg_backend_pid();" 2>/dev/null || true
echo "  Dropping kratos database..."
psql -h postgres -U postgres -c "DROP DATABASE IF EXISTS kratos" && echo "    Done" || echo "    FAILED"
echo "  Dropping hydra database..."
psql -h postgres -U postgres -c "DROP DATABASE IF EXISTS hydra" && echo "    Done" || echo "    FAILED"
echo "  Creating kratos database..."
psql -h postgres -U postgres -c "CREATE DATABASE kratos" && echo "    Done" || echo "    FAILED"
echo "  Creating hydra database..."
psql -h postgres -U postgres -c "CREATE DATABASE hydra" && echo "    Done" || echo "    FAILED"
echo "  Databases AFTER setup:"
psql -h postgres -U postgres -c "SELECT datname FROM pg_database WHERE datistemplate = false;"
echo "  Checking hydra database is empty..."
psql -h postgres -U postgres -d hydra -c "SELECT tablename FROM pg_tables WHERE schemaname = 'public';"

# Run migrations - must set DSN explicitly for each tool since -e reads from DSN env var
echo "Running Kratos migrations..."
DSN="$DSN" kratos migrate sql -e --yes --config /etc/config/kratos.yml

echo "Running Hydra migrations..."
DSN="$HYDRA_DSN" hydra migrate sql -e --yes --config /etc/config/hydra.yml

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
            \"redirect_uris\": [\"http://localhost:8081/auth/openidc/return\", \"http://127.0.0.1:8081/auth/openidc/return\"],
            \"token_endpoint_auth_method\": \"client_secret_basic\"
        }" > /dev/null
    echo "OAuth client '${OAUTH_CLIENT_ID}' created."
else
    echo "OAuth client '${OAUTH_CLIENT_ID}' already exists."
fi

# Create default admin user in Kratos if needed
echo "Checking for default admin user..."
DEFAULT_USER_EMAIL="${DEFAULT_USER_EMAIL:-admin@local.strato}"
DEFAULT_USER_PASSWORD="${DEFAULT_USER_PASSWORD:-localdev123}"

# Check if user exists by trying to get identities with that email
EXISTING_USER=$(curl -s "http://localhost:4434/admin/identities" | grep -o "\"$DEFAULT_USER_EMAIL\"" || true)

if [ -z "$EXISTING_USER" ]; then
    echo "Creating default admin user: $DEFAULT_USER_EMAIL"
    
    # Create identity via Kratos Admin API
    curl -s -X POST "http://localhost:4434/admin/identities" \
        -H "Content-Type: application/json" \
        -d "{
            \"schema_id\": \"default\",
            \"traits\": {
                \"email\": \"$DEFAULT_USER_EMAIL\",
                \"username\": \"admin\"
            },
            \"credentials\": {
                \"password\": {
                    \"config\": {
                        \"password\": \"$DEFAULT_USER_PASSWORD\"
                    }
                }
            },
            \"state\": \"active\"
        }" > /dev/null
    
    echo "Default user created."
    echo ""
    echo "============================================"
    echo "  Default credentials:"
    echo "    Email:    $DEFAULT_USER_EMAIL"
    echo "    Password: $DEFAULT_USER_PASSWORD"
    echo "============================================"
    echo ""
else
    echo "Default user already exists."
fi

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
