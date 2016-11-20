# cirrus

With `cirrus`, you can search your `strato` blockchain! It leverages [postgrest](http://postgrest.com) for your smart contracts.

## pre-requirements and installation

`cirrus` is now part of `silo` and hence is automatically deployed. For debugging purposes you can connect your `cirrus` container to an existing `silo` network and use `nodemon` for automatic restart.

## tutorial

1. `POST` the output of `bloc`'s `/state` route to `cirrus/contract/`, alternatively enable the option to `bloc` to post this on compilation. 
2. run `e2e/contract.test.js`

## routes

| Type   |      Route      |  Content-type | Info | Result |
|--------|-----------------|---------------|------|--------|
| `POST` |  `cirrus/contract` | `application/json`| Post schema | |
| `GET`  |  `cirrus/search/` | |  Returns contract types | |
| `GET`  | `cirrus/search/<ContractName>` | | Query a specific contract, see the [API reference](http://postgrest.com/api/reading/) | |

## roadmap

+ build our own `postgrest` instead of official docker image to enable:
 + history of accounts, using [temporal_tables](https://github.com/arkhipov/temporal_tables)
 + websockets, using [postgrest-ws](https://github.com/diogob/postgrest-ws)
+ statediffs on transaction level in addition to block level
