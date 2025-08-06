# Update Reserves with New Oracle Addresses

## Prepare
- Install dependencies:
  - Node.js v16+ is required
  - `npm install blockapps-rest dot-env`
- Add marketplace/backend/config.yaml with contents (MAKE SURE TO REPLACE THE __CLIENT_ID__ and __CLIENT_SECRET__ placeholders with credentials of a new payment client):
  ```yaml
  # config.yaml
  timeout: 600000
  VM: SolidVM
  configDirPath: /config
  serverHost: http://localhost
  dockerized: true

  nodes:
  - id: 0
    label:
    url: https://marketplace.mercata.blockapps.net
    oauth:
    appTokenCookieName:
    appTokenCookieMaxAge: 7776000000
    openIdDiscoveryUrl: https://keycloak.blockapps.net/auth/realms/mercata/.well-known/openid-configuration
    clientId: __CLIENT_ID__
    clientSecret: __CLIENT_SECRET__
    scope:
    serviceOAuthFlow:
    redirectUri: https://payments.mercata.blockapps.net/login/
    logoutRedirectUri: https://payments.mercata.blockapps.net
    tokenField:
    tokenUsernameProperty:
    tokenUsernamePropertyServiceFlow:
  ```
- Edit config.sh
  - Edit the oracle addresses
    - to obtain the oracle addresses, check oracle deployment log or oracle_deploy.yaml in the oracle container/volume.
  - Edit the reserve addresses
    - to obtain the reserve addresses, check cirrus at https://node1.mercata.blockapps.net/cirrus/search/BlockApps-Mercata-Reserve?creator=in.(BlockApps,mercata_usdst)&isActive=eq.true&select=address,name,creator,oracle
  - Edit the admin user username (mercata_usdt for prod, blockapps for testnet2)

## Execute
- Run with `./run.sh`

## (Alternative, for devs) Bash-less execution (node.js only)
- A single js-script run updates one oracle-reserve pair per run.
- Create `.env` from `.env.updateOracleOnReserve` and edit the values in it
- Run:
  ```
  node updateOracleOnReserve.js 2>&1 | tee -a r.log
  ```
