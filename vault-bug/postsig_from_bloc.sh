RUN=$1

curl -X POST http://vault-wrapper:8000/strato/v2.3/signature -H "X-USER-UNIQUE-NAME: service-account-dev-infinite@placeholder.org" -H "Content-Type: application/json" -d "{\"msgHash\": \"7371136f7e951a1a9106cd5a5fd48e97ced06a7cb7beeefda6800b7d8942056d\"}"

