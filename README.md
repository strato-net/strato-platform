# cirrus

With `cirrus`, you can search your `strato` blockchain! It leverages [postgrest](http://postgrest.com) for your smart contracts.

## pre-requirements and installation

`cirrus` assumes a running docker instance of `strato` on the same machine and connects to it on the default `docker_default` network. Once this is running, you can start `cirrus` by executing:

```sh
docker-compose up
```

## routes

| Type   |      Route      |  Content-type | Info | Result |
|--------|-----------------|---------------|------|--------|
| `POST` |  `cirrus:3333/` | `application/json`| Post schema | |
| `GET`  |  `cirrus:3001/` | |  Returns contract types | |
| `GET`  | `cirrus:3001/<ContractName>` | | Query a specific contract, see the [API reference](http://postgrest.com/api/reading/) | |

## roadmap

+ build our own `postgrest` instead of official docker image to enable:
 + history of accounts, using [temporal_tables](https://github.com/arkhipov/temporal_tables)
 + websockets, using [postgrest-ws](https://github.com/diogob/postgrest-ws)
+ statediffs on transaction level in addition to block level