# APEX

## SMD backend / STRATO Network Management / Authentication server

### To run in dev mode:
1. Run strato-getting-started single node locally with postgres port mapped to host (5432:5432)
2. cd `apex/api`
2. `stratoRoot=http://localhost/strato-api/eth/v1.2/ blocRoot=http://localhost/bloc/v2.2 npm run start:dev`

### To run tests against running STRATO node (be able to debug apex' tests or code)
1. Run strato-getting-started single node locally with postgres port mapped to host (5432:5432). It is fine to have Apex running in container (needs to be started to create the init data)
2. cd `apex/api`
3. `stratoRoot=http://localhost/strato-api/eth/v1.2 blocRoot=http://localhost/bloc/v2.2 NODE_HOST=localhost NODE_ENV=development SINGLE_NODE=true ./node_modules/mocha/bin/mocha $NODE_DEBUG_OPTION --config=config-local.yaml test/`

### To run in prod mode
see Jenkinsfile, Dockerfile, docker-run.sh etc
