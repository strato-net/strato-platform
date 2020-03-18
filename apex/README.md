# APEX (an SMD backend server)

## Prepare to run server/tests locally (development mode):
1. Run strato-getting-started single node locally with ports proxied (by changing docker-compose.yml):
    1. postgres (15433:5432)
    2. strato (3333:3000)
    3. bloc (8888:8000)
    4. vault-wrapper (8484:8000)
    5. postgrest (note the extra T) (3434:3001)
    6. prometheus (9090:9090)
2. cd `apex/api`

### Run Apex server locally (development mode):
(have prep steps 1 and 2 done)
3. ```
    OAUTH_ENABLED=true \ # if STRATO is OAUTH_ENABLED=true \
        stratoRoot=http://localhost:3333/eth/v1.2 \
        blocRoot=http://localhost:8888/bloc/v2.2 \
        postgres_port=15433 \
        vaultWrapperHttpHost=http://localhost:8484 \
        blocHttpHost=http://localhost:8888 \
        postgrestHttpHost=http://localhost:3434 \
        prometheusHost=localhost:9090 \
        EXT_STORAGE_S3_BUCKET=<AWS_BUCKET_NAME> \
        EXT_STORAGE_S3_ACCESS_KEY_ID=<AWS_KEY_ID> \
        EXT_STORAGE_S3_SECRET_ACCESS_KEY=<AWS_SECRET_ACCESS_KEY> \
        npm run start:dev
   ```
    (this is the list of vars passed to apex docker container in docker-compose.yml + the vars added with set-aux-env-vars.sh in prod / tests)

  You might need additional steps to comment out line `yield registerAppMetadata();` of bin/www to prevent server crashing.
  
  You might also want to temporary (don't push!) comment out lines `sockets.init(server);` and `const sockets = require('../sockets/init');` to turn off websocket server and stop getting `ECONNREFUSED 127.0.0.1:5432` errors from it (todo: find the way to run in dev mode too)
  
### Run Apex tests locally (development mode):
(have prep steps 1 and 2 done)
5. ```
    NODE_ENV=development \
        OAUTH_ENABLED=true \ # if STRATO is OAUTH_ENABLED=true
        stratoHost=localhost:3333 \
        blocHost=localhost:8888 \
        vaultWrapperHost=localhost:8484 \
        postgrestHost=localhost:3434 \
        posgtres_port=15433 \
        prometheusHost=localhost:9090 \
        EXT_STORAGE_S3_BUCKET=<AWS_BUCKET_NAME> \
        EXT_STORAGE_S3_ACCESS_KEY_ID=<AWS_KEY_ID> \
        EXT_STORAGE_S3_SECRET_ACCESS_KEY=<AWS_SECRET_ACCESS_KEY> \
        ./run-tests.sh`
   ```
   (this is the list of vars passed to apex docker container in docker-compose.yml)

## In docker (production mode)

### Run tests
1. ```
   docker exec -t -e NODE_ENV=test strato_apex_1 ./run-tests.sh
   ```
   
### Run server (production mode)
See: 
- Dockerfile for how we build
- docker-run.sh for how we run
- docker-compose.yml (docker-compose.tpl.yml) for the env vars passed
