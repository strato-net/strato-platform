# identity-provider

### What is an identity server?
This project is meant to help with the registration flow on STRATO. The identity server handles account creation and setup as needed. Specifically, it
1. creates a user's key in vault for them if they don't already have one
2. creates, signs, and registers a certificate on-chain for a user if they don't already have one
3. registers a user wallet on-chain for a user if they don't already have one

To utilize this functionality, you call the PUT /identity endpoint. You must also provide an Authorization header with the user's bearer token, and you can optionally specify the `company` as a query parameter. Whenever possible, the bearer token will be used as the source of truth for information about the user. The common name for the cert will either come from the token's `preferred_username` claim, if one exists, or the `name` claim. Similarly, if there is a `company` claim within the token, that will be used for the cert's organization field. If no claim `company` is found, the identity server will use the `company` query param value instead. Note that if both the `company` claim and query param are empty, the identity server will issue a cert with an empty organization name.

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
  ssl=false \
  SENDGRID_APIKEY=<key> \
  VAULT_URL=https://vault.blockapps.net:8093 \
  NODE_URL=https://marketplace.mercata.blockapps.net \
  OAUTH_CLIENT_ID=<client-id> \
  OAUTH_CLIENT_SECRET=<client-secret> \
  OAUTH_DISCOVERY_URL=<oauth-discovery-url> \
  ./identity
```
The minimum flags to provide are 
  - `OAUTH_DISCOVERY_URL` for the realm
  - `OAUTH_CLIENT_ID` for the identity server
  - `OAUTH_CLIENT_SECRET` for the identity server
  - `VAULT_URL` to connect to
  - `NODE_URL` to post transactions to
Additional flags that can be provided are
  - `FALLBACK_NODE_URL` in case `NODE_URL` is unresponsive
  - `USER_REGISTRY_ADDRESS` the address of the UserRegistry contract. By default this will be the location hardcoded in new genesis blocks: `0x720`. (*Note:* if using an older genesis block, you will not have this contract and should manually post it to the network, noting the address, code hash, and associated table name in cirrus.)
  - `USER_REGISTRY_CODEHASH` the code hash of the UserRegistry contract mentioned above. By default this will be the code hash of the hardcoded contract. If using an older genesis block, please see the note under `USER_REGISTRY_ADDRESS`
  - `USER_CONTRACT_NAME` the associated table name in cirrus for `User` contracts. By default this will be `BlockApps-UserRegistry-User`. If using an older genesis block, please see the note under `USER_REGISTRY_ADDRESS`
  - `NOTIFICATION_SERVER_URL` the url of an associated notification server url. If provided, the identity server will subscribe users to the notification server after registering them
  - `SENDGRID_APIKEY` used for sending the welcome email after registering a user

Like all our getting-started scripts, this should be run within the same directory where the identity server's docker-compose, `docker-compose.identity.yml`, is located.

[!IMPORTANT]
The information below is important!

3. An important step is setting the URL of your ID-server for your strato node. As of writing this, you can pass the argument in your strato-getting-started script for your node `idServerUrl="https://yourIdServerUrl.com"`, but that is not needed. If that variable is not set in the `sgs` script, it will use `https://identity.blockapps.net` by default on prod and `https://identity.mercata-testnet2.blockapps.net` on testnet

5.  The `strato-getting-started` directory has an `identity-provider` subdirectory from which files will be mounted onto the docker container. These files include `identity-provider/certs/rootPriv.pem` and `identity-provider/certs/rootCert.pem`. These files are not included in the docker image for security reasons, as they contain sensitive information. If you do not provide these files within the `identity-provider` subdirectory, the identity docker images may not work.

6. Keep in mind the client credentials you provide use MUST already have keys within the vault specified, and have a cert registered on the associated network.

### Things to consider when updating/restarting an identity server
1. The identity server is fairly stateless (with the exception of some caches stored in-memory), so it's quite safe to wipe and restart the server arbitrarily.