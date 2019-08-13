# APEX

## SMD backend / STRATO Network Management / Authentication server

### To run in dev mode:
1. Run strato-getting-started single node locally with ports proxied (by changing docker-compose.yml):
    1. postgres port mapped to host (5433:5432)
    2. strato port mapped to (3333:3000)
    3. bloc port mapped to (8888:8000)
    4. vault-wrapper port mapped to (8484:8000)
    5. postgrest (note the xtra t) port mapped to (3434:3001)
2. cd `apex/api`
3. `OAUTH_ENABLED=true \ # if STRATO is OAUTH_ENABLED=true \
    stratoRoot=http://localhost:3333/eth/v1.2 \
    blocRoot=http://localhost:8888/bloc/v2.2 \
    postgresPort=5433 \
    vaultWrapperHttpHost=http://localhost:8484 \
    blocHttpHost=http://localhost:8888 \
    postgrestHttpHost=http://localhost:3434 \
    EXT_STORAGE_S3_BUCKET=strato-external-storage \
    EXT_STORAGE_S3_ACCESS_KEY_ID=<AWS_KEY_ID> \
    EXT_STORAGE_S3_SECRET_ACCESS_KEY=<AWS_SECRET_ACCESS_KEY> \
    npm run start:dev`

### To run tests against running STRATO node (be able to debug apex' tests or code)
(if `apex_dev` database has not yet been created, run dev mode steps above)
1. Run strato-getting-started single locally with 
    1. strato port mapped to (3333:3000)
    2. bloc port mapped to (8888:8000)
    3. vault-wrapper port mapped to (8484:8000)
    4. postgres port mapped to (5433:5432) 
    5. postgrest (note the xtra t) port mapped to (3434:3001)
2. cd `apex/api`
3. `NODE_ENV=development \
    OAUTH_ENABLED=true \ # if STRATO is OAUTH_ENABLED=true
    STRATO_HOST=localhost:3333 \
    BLOC_HOST=localhost:8888 \
    VAULT_HOST=localhost:8484 \
    POSTGREST_HOST=localhost:3434 \
    POSTGRES_PORT=5433 \
    EXT_STORAGE_S3_BUCKET=strato-external-storage \
    EXT_STORAGE_S3_ACCESS_KEY_ID=<AWS_KEY_ID> \
    EXT_STORAGE_S3_SECRET_ACCESS_KEY=<AWS_SECRET_ACCESS_KEY> \
    ./run-tests.sh`

### To run in prod mode
see Jenkinsfile, Dockerfile, docker-run.sh etc
