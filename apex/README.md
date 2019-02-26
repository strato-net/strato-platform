# APEX

## SMD backend / STRATO Network Management / Authentication server

### To run in dev mode:
1. Run strato-getting-started single node locally with postgres port mapped to host (5432:5432)
2. cd `apex/api`
2. `stratoRoot=http://localhost/strato-api/eth/v1.2/ blocRoot=http://localhost/bloc/v2.2 npm run start:dev`

### To run tests against running STRATO node (be able to debug apex' tests or code)
1. Run strato-getting-started single locally with 
    1. strato port mapped to (3333:3000)
    2. bloc port mapped to (8888:8000)
    3. vault-wrapper port mapped to (8484:8000)
2. cd `apex/api`
3. `sudo NODE_ENV=development OAUTH_ENABLED=true STRATO_HOST=http://localhost:3333 BLOC_HOST=http://localhost:8888 VAULT_HOST=http://localhost:8484 ./run-tests.sh`

### To run in prod mode
see Jenkinsfile, Dockerfile, docker-run.sh etc
