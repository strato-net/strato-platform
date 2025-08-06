# Oauth test cases


## NOTICE: a work has been done to make this tests run on Mercata 11.2. The tests don't pass due to the API-related changes since they were created, but the suite itself can be started and can be used for future tests




Demo app that uses STRATO to track products through a supply chain using OAuth and Private chains.

## STRATO

### STRATO single node running with:
  ```
  OAUTH_DISCOVERY_URL=https://keycloak.blockapps.net/auth/realms/strato-devel/.well-known/openid-configuration \
  ```
  (see jenkins test pipelines for more STRATO settings, e.g.: ../pipelines/Jenkinsfile.autobuild Deploy stage)

#### Steps to run the testcases:

##### Command to be executed:

```
cd ../blockapps-rest
yarn
yarn build
cd -
yarn
CONFIG_FILE=<CONFIG_FILE_PATH> yarn load:test
  # or 'yarn load:test:agreement'
  # or 'yarn load:test:agreementManager
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
      clientId: 'dev'
      clientSecret: 'd5e67b8c-4fbf-42c6-a8d9-29a4dd13575f'
      openIdDiscoveryUrl: "https://keycloak.blockapps.net/auth/realms/strato-devel/.well-known/openid-configuration"
      redirectUri: "http://localhost/callback"
      logoutRedirectUri: "http://localhost"

```

**NOTE:** *multinode* key is used for multinode test cases. Remove it while working on single node
