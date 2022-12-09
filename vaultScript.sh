# Build:
REPO=local make vault-wrapper vault-nginx docker-compose

# Run:
INITIAL_OAUTH_DISCOVERY_URL='https://keycloak.blockapps.net/auth/realms/strato-devel/.well-known/openid-configuration' \
  INITIAL_OAUTH_ISSUER='https://keycloak.blockapps.net/auth/realms/strato-devel' \
  INITIAL_OAUTH_JWT_USERNAME_PROPERTY='sub' \
  docker-compose -p vault -f docker-compose.vault.tpl.yml up -d

# Set vault password: 
docker exec -i vault_vault-wrapper_1 curl -s -H "Content-Type: application/json" -d @- localhost:8000/strato/v2.3/password <<< \"123\"
