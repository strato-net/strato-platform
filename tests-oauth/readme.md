# Oauth test cases

Demo app that uses STRATO to track products through a supply chain using OAuth and Private chains.

## Strato

### STRATO node running with parameters:
   ```
  OAUTH_ENABLED=true \
  OAUTH_CLIENT_ID=dev-infinite \
  OAUTH_CLIENT_SECRET=091a22ec-3c81-4be4-83fb-d9f82084c3e8 \
  OAUTH_DISCOVERY_URL=https://keycloak.blockapps.net/auth/realms/strato-devel/.well-known/openid-configuration \
  OAUTH_JWT_USERNAME_PROPERTY=email \
  ./strato.sh --single
   ```

#### Steps to run the testcases:

##### Enviorment variable:

```
create .env file in root and add this token

USER_TOKEN=eyJhbGciOiJSUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIiA6ICJWY0N4SEpnUjFOdnJ4UWR5QXhQcEI5VEowM205SVRDdWt0b1JfTENVSE1VIn0.eyJqdGkiOiJlZGRjNWE1ZC0wZjgyLTRjNTItOTFlOC01Nzk1NTM1ZGUxMWEiLCJleHAiOjIwMDQ2MTkyNDAsIm5iZiI6MCwiaWF0IjoxNTcyNjE5NDM4LCJpc3MiOiJodHRwczovL2tleWNsb2FrLmJsb2NrYXBwcy5uZXQvYXV0aC9yZWFsbXMvc3RyYXRvLWRldmVsIiwiYXVkIjoiYWNjb3VudCIsInN1YiI6ImNhYzkxNWNlLWIzMWItNDMwMi05MjNmLWVlMGM3OWM0YWEyNyIsInR5cCI6IkJlYXJlciIsImF6cCI6ImRldi1pbmZpbml0ZSIsImF1dGhfdGltZSI6MTU3MjYxOTI0MCwic2Vzc2lvbl9zdGF0ZSI6ImJkZGRhY2RlLTZkNGItNDE5Ny05OTcwLTUyZTc2ODJhZjQ1NCIsImFjciI6IjAiLCJyZWFsbV9hY2Nlc3MiOnsicm9sZXMiOlsib2ZmbGluZV9hY2Nlc3MiLCJ1bWFfYXV0aG9yaXphdGlvbiJdfSwicmVzb3VyY2VfYWNjZXNzIjp7ImFjY291bnQiOnsicm9sZXMiOlsibWFuYWdlLWFjY291bnQiLCJtYW5hZ2UtYWNjb3VudC1saW5rcyIsInZpZXctcHJvZmlsZSJdfX0sInNjb3BlIjoib3BlbmlkIGVtYWlsIHByb2ZpbGUiLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwicHJlZmVycmVkX3VzZXJuYW1lIjoidXNlcjEiLCJlbWFpbCI6InVzZXIxQGJsb2NrYXBwcy5uZXQifQ.aVqM1Y5Zubic25jf1E9GjL1G0VeOrnyRVg_AUj48YPTGLE79ecLOpv--9zPX2bOkKdC3cWgdA89TiururvjzD2tgOBLNZHNdNi2I9mrL9BOiljayASUr0tZOC1EgI1zQ-dKyXm4XWR1H3_GxPfYEXfQHa7xrQfOnsgK-3fvxgc3gLLnfCXO2ykrGy0R45-rFllwdoUTPyeufTa0wvz-cE_LjDJ8aDOoHhfhK1ZyGEBYMVIlpIr-sXAv3BX0BqUbSknngJcCvOqbqQ-eUvMPxmcHFnVaWm-E-eGs8n4frJMVMiLMuVUvJqPzYksedFEg4wlrsJ-hWJGc4f9PFRfm4yA
```

##### Command to be executed:

```
yarn install
yarn build <- this is using repo blockapps-rest
CONFIG_FILE=<CONFIG_FILE_PATH> yarn load:test
```

#### Config file setup:

This testcases is genralised and you can add any contract and run for load test. Config should be like this: 

```
apiDebug: false
VM: SolidVM
timeout: 600000
batchCount: 2
batchSize: 10

# NOTE: mention nodes excluding current node
multinode:
  runTest: true
  nodes: 
    - http://multinode201.ci.blockapps.net
    - http://multinode202.ci.blockapps.net

contract: 
  name: 'AgreementManager'
  filePath: './contracts/beanstalk/agreement/AgreementManager.sol'
  args: 
    _dappAddress: 2383914a2cffe7bb97e0b622481b945858e08188
    _permissionManager: '2383914a2cffe7bb97e0b622481b945858e08188'
    _programManager: '2383914a2cffe7bb97e0b622481b945858e08188'
    _userManager: '2383914a2cffe7bb97e0b622481b945858e08188'

nodes:
  - id: 0
    url: 'http://localhost'
    publicKey: '6d8a80d14311c39f35f516fa664deaaaa13e85b2f7493f37f6144d86991ec012937307647bd3b9a82abe2974e1407241d54947bbb39763a4cac9f77166ad92a0'
    port: 30303
    oauth:
      appTokenCookieName: "oauth_tests"
      scope: 'email openid'
      appTokenCookieMaxAge: 7776000000 # 90 days: 90 * 24 * 60 * 60 * 1000
      clientId: 'dev-infinite'
      clientSecret: '091a22ec-3c81-4be4-83fb-d9f82084c3e8'
      openIdDiscoveryUrl: "https://keycloak.blockapps.net/auth/realms/strato-devel/.well-known/openid-configuration"
      redirectUri: "http://localhost/callback"
      logoutRedirectUri: "http://localhost"

```

**NOTE:** *multinode* key is used for multinode test cases. Remove it while working on single node
