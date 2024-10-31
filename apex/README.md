# APEX (an SMD backend server)

## Prepare to run server/tests locally (development mode):
0. Use the same NodeJS version as in Dockerfile (e.g. `nvm install 21.7.1 && nvm use 21`).
1. Run strato-getting-started single node locally with ports proxied (by changing docker-compose.yml):
    1. postgres (15433:5432)
    2. prometheus (9090:9090)
    3. strato (3333:3000; 8484:8000) // TODO: Replace VaultProxy port 8000 with the actual one that the VaultProxy is served on in the strato container
2. cd `apex/api`

### Run Apex server locally (development mode):
(have prep steps 1 and 2 done)
3. ```
    postgres_port=15433 \
        PROMETHEUS_HOST=localhost:9090 \
        stratoRoot=http://localhost:3333/eth/v1.2 \  # note the stratoRoot, not STRATO_HOST \
        vaultProxyUrl=http://localhost:8484 \
        STRATO_VERSION=8.0.0 \
        npm run start:dev
   ```
    (this is the list of vars passed to apex docker container in docker-compose.yml + some vars are added with set-aux-env-vars.sh in prod / tests)

  
### Run Apex tests locally (development mode):
(have prep steps 1 and 2 done)
5. ```
    NODE_ENV=development \
        postgres_port=15433 \
        PROMETHEUS_HOST=localhost:9090 \
        STRATO_HOSTNAME=localhost \ # note the STRATO_HOST, not stratoRoot, because we run the set-aux-env-vars.sh as part of ./run-tests.sh \
        STRATO_PORT_API=3333 \
        STRATO_PORT_VAULT_PROXY=8484 \
        VAULT_PROXY_HOST=http://localhost:8484 \
        STRATO_VERSION=8.0.0 \
        ./run-tests.sh`
   ```
   (this is the list of vars passed to apex docker container in docker-compose.yml)

## In docker (production mode)

### Run tests
1. ```
   docker exec -t -e NODE_ENV=test strato-apex-1 ./run-tests.sh
   ```
   
### Run server (production mode)
See: 
- Dockerfile for how we build
- docker-run.sh for how we run
- docker-compose.yml (docker-compose.tpl.yml) for the env vars passed
