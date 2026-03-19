#!/bin/bash

set -e
set -x

Green='\033[0;32m'
Red='\033[0;31m'
Yellow='\033[0;33m'
BYellow='\033[1;33m'
NC='\033[0m'

# ─── INIT MODE ───────────────────────────────────────────────────────────────
# When called with --init, run strato-setup to generate node config and exit.
# Used as the init container in docker-compose (runs before postgres/strato start).
if [ "$1" = "--init" ]; then
  echo -e "${Yellow}Running strato-setup init...${NC}"
  cd /var/lib/strato

  # Skip if already initialized
  if [ -f .ethereumH/ethconf.yaml ]; then
    echo -e "${Green}Node already initialized, skipping.${NC}"
    exit 0
  fi

  # Create OAuth credentials from env vars for strato-setup
  if [[ -n ${OAUTH_CLIENT_ID} && -n ${OAUTH_CLIENT_SECRET} ]]; then
    mkdir -p ~/.secrets
    cat > ~/.secrets/strato_credentials.yaml << EOF
discoveryUrl: "${OAUTH_DISCOVERY_URL:-https://keycloak.blockapps.net/auth/realms/mercata/.well-known/openid-configuration}"
clientId: "${OAUTH_CLIENT_ID}"
clientSecret: "${OAUTH_CLIENT_SECRET}"
EOF
  fi

  # Run strato-setup to create node directory, ethconf, secrets, genesis
  strato-setup /var/lib/strato \
    --network="${network:-helium}" \
    --vaultUrl="${VAULT_URL:-https://vault.blockapps.net:8093}/strato/v2.3" \
    --pghost="${postgres_host:-postgres}" \
    --kafkahost="${kafkaHost:-kafka}" \
    --redisHost="${redisHost:-redis}" \
    --apiIPAddress=0.0.0.0

  echo -e "${Green}Node initialization complete.${NC}"
  exit 0
fi

# ─── NORMAL STRATO MODE ─────────────────────────────────────────────────────

echo 'export PS1="⛓ \w> "' >> /root/.bashrc

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

# Go to node directory (created by init container via strato-setup)
cd /var/lib/strato

# Debug: show current state
echo "Working directory: $(pwd)"
echo "Node contents:"
ls -la

# Wait for custom genesis if requested
if [[ ${useCustomGenesis:-false} = "true" && ! -f "genesis.json" ]] ; then
  set +x
  echo "useCustomGenesis is set to true - waiting for genesis.json..."
  echo "Use: docker cp myGenesisFile.json strato-strato-1:/var/lib/strato/genesis.json"
  while [ ! -f "genesis.json" ]; do
    sleep 1
  done
  echo "File genesis.json found! Continuing..."
  set -x
fi

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

# Verify node was set up by init container (strato-setup)
if [ ! -f .ethereumH/ethconf.yaml ]; then
  echo -e "${Red}ERROR: Node not initialized. The strato-init service must run first.${NC}"
  echo "Expected to find: /var/lib/strato/.ethereumH/ethconf.yaml"
  exit 1
fi

if [ ! -f commands.txt ]; then
  echo -e "${Red}ERROR: commands.txt not found. The strato-init service must run first.${NC}"
  exit 1
fi

echo -e "${Green}Starting STRATO processes via convoke...${NC}"

# Run convoke to supervise all processes (--no-docker since we're inside Docker)
exec convoke --no-docker
