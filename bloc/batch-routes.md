# Bloc batch transaction routes

All of them take a "resolve" parameter, which determines whether the response is
merely the list of transaction hashes or whether it contains the more detailed
output described below.

## /sendList

Input:
```
{
  "password": <string>,
  "resolve": <boolean>,
  "txs": [
    {
      "toAddress": <hex string>,
      "value": <ether in integer>
    },
    ...
  ]
}
```

Output entry:
```
{
  "senderBalance": <balance after transaction>
}
```

## /uploadList

Input:
```
{
  "password": <string>,
  "resolve": <boolean>,
  "txs": [
    {
      "contractName": <string, contract source already uploaded>
      "args": {value, gasPrice, gasLimit}
    },
    ...
  ]

}
```

Output entry:
```
{
  "contractJSON": <string, detached uploaded contract>
}
```

## /callList
```
{
  "password": <string>,
  "resolve": <boolean>,
  "txs": [
    {
      "contractName": <string, contract source already uploaded>
      "args": {value, gasPrice, gasLimit},
      "contractAddress": <hex string>,
      "methodName": <string>
    },
    ...
  ]

}
```

Output entry:
```
{
  "returnValue": <type-correct return value>
}
```
