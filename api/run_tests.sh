set -o
cd test/testdata
rm -rf testdata.zip addresses.js
zip -r testdata.zip .
cd -
export SINGLE_NODE=true
export NODE_HOST=localhost
export NODE_ENV=test
export stratoRoot=http://localhost/strato-api/eth/v1.2/
mocha --config=config-local.yaml test/
