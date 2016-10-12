# cirrus

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
| `GET`  | `cirrus:3001/<ContractName>` | | Query a specific contract | |
