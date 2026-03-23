#!/bin/bash

set -e
set -x

Green='\033[0;32m'
Red='\033[0;31m'
Yellow='\033[0;33m'
BYellow='\033[1;33m'
NC='\033[0m'

# Node config (ethconf.yaml, secrets, genesis) is created by strato-setup
# which runs BEFORE docker-compose up (in the bootstrap-docker/strato script).

# Set prompt for interactive debugging
echo 'export PS1="⛓ \w> "' >> ~/.bashrc

# Environment variable defaults
: ${postgres_host:=postgres}
: ${postgres_port:=5432}
: ${postgres_user:=postgres}
: ${kafkaHost:=kafka}
: ${kafkaPort:=9092}
: ${redisHost:=redis}
: ${redisPort:=6379}

PSQL_CONNECTION_PARAMS="-h ${postgres_host} -p ${postgres_port} -U ${postgres_user}"

echo 'Waiting for Postgres to be available...'
until pg_isready ${PSQL_CONNECTION_PARAMS}
do
  echo "Check at $(date)"
  sleep 0.5
done
echo 'Postgres is available'

echo 'Waiting for Kafka to be available...'
until nc -z ${kafkaHost} ${kafkaPort}
do
  echo "Waiting for Kafka at ${kafkaHost}:${kafkaPort}..."
  sleep 1
done
echo 'Kafka is available'

# Go to node directory (created by strato-setup before docker-compose up)
cd /var/lib/strato

# Debug: show current state
echo "Working directory: $(pwd)"
echo "Node contents:"
ls -la

# Write OAuth credentials for the Haskell processes
if [[ -n ${OAUTH_CLIENT_ID} && -n ${OAUTH_CLIENT_SECRET} ]]; then
  mkdir -p ~/.secrets
  cat > ~/.secrets/strato_credentials.yaml << EOF
discoveryUrl: "${OAUTH_DISCOVERY_URL:-https://keycloak.blockapps.net/auth/realms/mercata/.well-known/openid-configuration}"
clientId: "${OAUTH_CLIENT_ID}"
clientSecret: "${OAUTH_CLIENT_SECRET}"
EOF
fi

# Create faucet key if needed
mkdir -p config
if [ ! -f config/priv ]; then
  echo -ne "\x1d\xd8\x85\xa4\x23\xf4\xe2\x12\x74\x0f\x11\x6a\xfa\x66\xd4\x0a\xaf\xdb\xb3\xa3\x81\x07\x91\x50\x37\x18\x01\x87\x1d\x9e\xa2\x81" > config/priv
fi

echo -e "${Green}Starting STRATO processes via convoke...${NC}"

# Run convoke to supervise all processes (--no-docker since we're inside Docker)
exec convoke --no-docker
