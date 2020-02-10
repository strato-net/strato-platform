I've created two simple tests to recreate the vault-wrapper halting bug.
With the resource-pool config changed (larger stripe count and resource
count), I have been unable to recreate it. But before I made that change,
I was able to recreate it using these tests.

## NodeJS Test

The first test is a NodeJS test. Spin up STRATO with oauth enabled, and copy
those oauth credentials into the `config.yaml` file in this directory.

Here is the run script I used to start STRATO:

```
#!/usr/bin/env sh


# "address": "eccc10bb0fe48d7dc6d9eaaa9d3c7ea4fadf4ee0",
# "private_key": "BWSZaYZVFpzL8/Lf6tKSzv8hRSXI4a/h9P91jJj1aYA="


./strato --wipe

NODE_HOST="localhost:8080" \
  HTTP_PORT="8080" \
  OAUTH_ENABLED=true \
  OAUTH_DISCOVERY_URL=https://keycloak.blockapps.net/auth/realms/strato-devel/.well-known/openid-configuration \
  OAUTH_CLIENT_ID=dev-infinite \
  OAUTH_CLIENT_SECRET=091a22ec-3c81-4be4-83fb-d9f82084c3e8 \
  PASSWORD=1234 \
  blockstanbulPrivateKey="BWSZaYZVFpzL8/Lf6tKSzv8hRSXI4a/h9P91jJj1aYA=" \
  validators='["eccc10bb0fe48d7dc6d9eaaa9d3c7ea4fadf4ee0"]' \
  VAULTWRAPPER_DEBUG=true \
 ./strato --blockstanbul
```

Here is the `config.yaml` I used:

```
apiDebug: true
password: '1234'
timeout: 600000
libPath: ./
contractsPath: ./contracts/
nodes:
  - id: 0
    url: 'http://localhost:8080'
    publicKey: >-
      6d8a80d14311c39f35f516fa664deaaaa13e85b2f7493f37f6144d86991ec012937307647bd3b9a82abe2974e1407241d54947bbb39763a4cac9f77166ad92a0
    port: 30303
    oauth:
      appTokenCookieName: dapp_test_session
      scope: email openid
      appTokenCookieMaxAge: 7776000000
      clientId: dev-infinite
      clientSecret: 091a22ec-3c81-4be4-83fb-d9f82084c3e8 
      openIdDiscoveryUrl: https://keycloak.blockapps.net/auth/realms/strato-devel/.well-known/openid-configuration 
      redirectUri: 'http://localhost'
      logoutRedirectUri: 'http://localhost'

```

Once you have STRATO running and your `config.yaml` set, run `yarn start`. 

The test creates a user, creates a simple contract, and calls a function of that contract
a bunch of times (~25) asynchronously.



## Curl Test

The other test I wrote directly curls `POST /signature` route in vault-wrapper, from the bloc container.
You must copy the two scripts into the bloc container. Run the following commands:

```
docker cp async_postsig.sh strato_bloc_1:/
docker cp postsig_from_bloc.sh strato_bloc_1:/
```

Then, run a bash session in the bloc container and execute the async script:

```
docker exec -it strato_bloc_1 bash
./async_postsig.sh
```


## Extra: GET Key

I also added a little script that calls `GET /key` a bunch of times to check whether
vault-wrapper has halted. TO run it, first run `yarn start` and copy the oauth token
for the current STRATO session into the Authorization header field of the curl command
in `getKeyNTimes.sh`. This token will be dumped to the console in the first few lines
of output after running `yarn start`.

Once the token is copied, run `./getKeyNTimes.sh`. If any one of the calls
halts, vault-wrapper has halted. 





