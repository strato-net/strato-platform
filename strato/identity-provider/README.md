# identity-provider

### What is an identity server?
This project is meant to help with the registration flow on STRATO. The identity server handles account creation and setup as needed. Specifically, it
1. creates a user's key in vault for them if they don't already have one
2. creates, signs, and registers a certificate on-chain for a user if they don't already have one
3. registers a user wallet on-chain for a user if they don't already have one

To utilize this functionality, you call the PUT /identity endpoint. You must also provide an Authorization header with the user's bearer token, and you can optionally specify the `company` as a query parameter. The common name for the cert will either come from the token's `preferred_username` claim, if one exists, or the `name` claim. To customize the common name to be a different value, you may provide one in the `CUSTOM-COMMON-NAME` header. As long as there is not already a certificate issued for the owner of the JWT nor already a certificate that has that common name, a new cert will be issued. The cert's organization field will come from the `company` claim within the token, if one exists. If no claim `company` is found, the identity server will use the `company` query param value instead. Note that if both the `company` claim and query param are empty, the identity server will NOT issue a cert with an empty organization name. Instead, it will use the default naming behavior for Mercata users with no org:
`Mercata Acount <first initial><last name><first 8 chars of uuid>`

### What other services does the identity server talk to?
The identity server is connected to vault so that it can create a keypair for an incoming user if they don't already have one.

You can optionally also connect the identity server to a notification server so that it can automatically subscribe users for notifications. To indicate you do not want to subscribe, add `subscribe=false` as a query parameter when calling PUT /identity. **Please note:** the identity server will only attempt to subscribe a user if it detects that an account is being created for the first time. If an existing account (has keypair and cert) tries to call PUT /identity with `subscribe=true`, the identity server will ignore this and make no call to the notification server.

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
  ./identity
```

Like all our getting-started scripts, this should be run within the same directory where the identity server's docker-compose, `docker-compose.identity.yml`, is located.

3. Keep in mind that due to the identity server's reliance on the `company` claim in the provided bearer token, we ideally want to have our realms support this claim. The identity server can function without this claim being in the token, but these certs may take a different form than is expected (for example, if the `company` claim is missing, the cert created may have a suprising value for the `organization` field). 

[!IMPORTANT]
The information below is important!

4. An important step is setting the URL to you ID-server for your strato node. As of writing this, you can pass the argument in your strato-getting-started script for your node `idServerUrl="https://yourIdServerUrl.com"`, but that is not needed. If that variable is not set in the `sgs` script, it will use `https://identity.blockapps.net` by default on prod and `https://identity.mercata-testnet2.blockapps.net` on testnet

5.  The `strato-getting-started` directory has an `identity-provider` subdirectory from which files will be mounted onto the docker container. These files include `identity-provider/certs/rootPriv.pem`, `identity-provider/certs/rootCert.pem`, and `identity-provider/idconf.yaml`. These files are not included in the docker image for security reasons, as they contain sensitive information. If you do not provide these files within the `identity-provider` subdirectory, the identity docker images will not build.

6. The configuration file `identity-provider/idconf.yaml` contains a list of realm-specific information. Each realm's details is grouped in a single yaml list element. The minimum realm details to provide are 
  a. `discoveryUrl` for the realm (needed to extract the issuer information and token endpoint)
  b. `clientId` for the identity server
  c. `clientSecret` for the identity server
In addition, you may also choose to specifiy
  d. `realmName` for readability's sake (does not affect functionality)
  e. `nodeUrl` of the STRATO node to query and post transactions to. By default this will be `https://node2.<realmName>.blockapps.net`
  f. `fallbackNodeUrl` of another STRATO node in case the first one is unresponsive. By default this will be `https://node1.<realmName>.blockapps.net`
  g. `userRegistryAddress` the address of the UserRegistry contract. By default this will be the location hardcoded in new genesis blocks: `0x720`. 
    *Note:* if using an older genesis block, you will not have this contract and should manually post it to the network, noting the address, code hash, and associated table name in cirrus.
  h. `userRegistryCodeHash` the code hash of the UserRegistry contract mentioned above. By default this will be the code hash of the hardcoded contract. If using an older genesis block, please see the note under `userRegistryAddress`
  i. `userTableName` the associated table name in cirrus for `User` contracts. By default this will be `User`. If using an older genesis block, please see the note under `userRegistryAddress`

7. Keep in mind the client credentials you provide use MUST already have keys within the vault specified, and have a cert registered on the associated network.

### Things to consider when updating/restarting an identity server
1. The main reason for wanting to update the identity server is to update the realms it supports. To do this, add a list element in `identity-provider/idconf.yaml` and specify at minimum a `clientId`, `clientSecret`, and `discoveryUrl` for the realm. You will need to explicitly stop the docker containers and restart them in order to have the identity server read in the new realm information. 

2. The identity server is fairly stateless (with the exception of some caches stored in-memory), so it's quite safe to wipe and restart the server arbitrarily.