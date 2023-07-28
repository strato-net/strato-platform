# identity-provider

### Notes to the server admin

1. Like Vault, there are four folder directories associated with the identity server to be aware of:
    a. This folder, `strato-platform/strato/identity-provider`. Here the API endpoints, client bindings, and the servant backend ID server reside.
    b. `strato-platform/identity-nginx` is where the Identity nginx, the reverse proxy for the ID server, lives.
    c. An API endpoint/handler for the node to communicate with the ID server is located in `strato-platform/strato/api/core/src/Handlers/IdentityServerCallback.hs`.
    d. Identity "Getting-started" script is inside the `strato-getting-started` directory.

### Things to consider when starting the ID server

Make sure your options/configuration are set properly.

1. In `strato-platform/strato/identity-provider/server/app/Options.hs`, there are options that can be set, but usually, those options do not need to be touched because they are set with the `identity server's getting-started-script`.
2. The arguments for the `identity getting-started script`:

```console
HTTP_PORT=8080 \
  OAUTH_DISCOVERY_URL=<keycloak> \
  OAUTH_CLIENT_ID=<localhost> \
  OAUTH_CLIENT_SECRET=<secret> \
  OAUTH_MASTER_CLIENT_ID=<master_client> \
  OAUTH_MASTER_CLIENT_SECRET=<master_client_secret> \
  VAULT_URL=https://vault.blockapps.net:8093 \
  realmName=mercata-testnet \
  nodeUrl=https://node2.mercata-testnet2.blockapps.net \
  ./idServerStart.sh
```

Like all our getting-started scripts, this should be run within the same directory where the identity server's docker-compose, docker-compose.identity.yml, is located.

[!IMPORTANT]
The below is important!

3. An important step is setting th URL to you ID-server for your strato node. As of this writing, you can pass the arguement in you strato-getting-started script for your node `idServerUrl="https://yourIdServerUrl.com"`, but that is not needed. If that variable is not set in the `sgs` script, the network flag is used to map to a hardcoded ID server url. 
4.  In the `strato-platform/strato/identity-provider` directory, needs a `rootPriv.pem` and `rootCert.pem` . As of now in the Makefile there is a `if statement` that will move the `.pem` files if present to the identity server docker container, but if not present strato will build, but there will be a runtime error when trying to run the identity server.