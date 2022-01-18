# APEX (an SMD backend server)

## Prepare to run server/tests locally (development mode):
0. Use the same NodeJS version as in Dockerfile (e.g. `nvm install 8 && nvm use 8`). As of Dec 2021, using the newer node version (like 14) with current Apex code makes all DB queries stall (and no migrations run on first start).
1. Run strato-getting-started single node locally with ports proxied (by changing docker-compose.yml):
    1. postgres (15433:5432)
    2. strato (3333:3000)
    3. vault-wrapper (8484:8000)
    4. postgrest (note the extra T) (3434:3001)
    5. prometheus (9090:9090)
    6. bloc (8888:8000) (!only if using USE_OLD_STRATO_API=true)
2. cd `apex/api`
3. Temporary (don't push!) comment out line `const registerAppMetadata = require('../migrations/init-script/registerAppMetadata');` and line `yield registerAppMetadata();` of `apex/api/bin/www` to prevent server crashing.

### Run Apex server locally (development mode):
(have prep steps 1 and 2 done)
3. ```
    OAUTH_ENABLED=true \ # if STRATO is OAUTH_ENABLED=true \
        stratoRoot=http://localhost:3333/eth/v1.2 \
   
        blocHttpHost=http://localhost:3333 \
        blocRoot=http://localhost:3333/bloc/v2.2 \
            or for USE_OLD_STRATO_API=true:
        blocHttpHost=http://localhost:8888 \
        blocRoot=http://localhost:8888/bloc/v2.2 \
        
   
        postgres_port=15433 \
        vaultWrapperHttpHost=http://localhost:8484 \
        postgrestHttpHost=http://localhost:3434 \
        prometheusHost=localhost:9090 \
        EXT_STORAGE_S3_BUCKET=<AWS_BUCKET_NAME> \
        EXT_STORAGE_S3_ACCESS_KEY_ID=<AWS_KEY_ID> \
        EXT_STORAGE_S3_SECRET_ACCESS_KEY=<AWS_SECRET_ACCESS_KEY> \
        NODE_HOST=localhost:8080 \ # not called, just used as node unique id \
        STRATO_VERSION=6.0.3 \
        npm run start:dev
   ```
    (this is the list of vars passed to apex docker container in docker-compose.yml + the vars added with set-aux-env-vars.sh in prod / tests)

  
### Run Apex tests locally (development mode):
(have prep steps 1 and 2 done)
5. ```
    NODE_ENV=development \
        OAUTH_ENABLED=true \ # if STRATO is OAUTH_ENABLED=true
        stratoHost=localhost:3333 \
   
        blocHost=localhost:3333 \
            or for USE_OLD_STRATO_API=true:
        blocHost=localhost:8888 \
   
        vaultWrapperHost=localhost:8484 \
        postgrestHost=localhost:3434 \
        postgres_port=15433 \
        prometheusHost=localhost:9090 \
        EXT_STORAGE_S3_BUCKET=<AWS_BUCKET_NAME> \
        EXT_STORAGE_S3_ACCESS_KEY_ID=<AWS_KEY_ID> \
        EXT_STORAGE_S3_SECRET_ACCESS_KEY=<AWS_SECRET_ACCESS_KEY> \
        NODE_HOST=localhost:8080 \ # not called, just used as node unique id \
        STRATO_VERSION=6.0.3 \
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
