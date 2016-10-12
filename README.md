# cirrus

## pre-requirements and installation

`cirrus` assumes a running docker instance of `strato` on the same machine and connects to it on the default `docker_default` network. Once this is running, you can start `cirrus` by executing:

+ `docker-compose up`

## routes

+ `POST` `cirrus:3333/`
+ `GET` `cirrus:3001/`
+ `GET` `cirrus:3001/<ContractName>`