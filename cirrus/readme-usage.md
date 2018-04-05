# Cirrus

To make it easy to view smart contract state we built Cirrus, a service that indexes smart contracts and allows the use of a RESTful API to query contract data.

### Uploading a Contract to Cirrus

Let's try to upload the `SimpleStorage` contract to Cirrus.
Here is the source code.
```
contract SimpleStorage {
  uint storedData;
  function set(uint x) { storedData = x; }
  function get() returns (uint retVal) { return storedData; }
}```


We can upload it using the same bloc endpoint for compiling contracts but in order to index to Cirrus, we must provide the contract name as a tag.
```bash
curl -X POST "http://localhost/bloc/v2.1/contracts/compile" -H  "accept: application/json;charset=utf-8" -H  "content-type: application/json;charset=utf-8" -d "[  {    \"contractName\": \"SimpleStorage\",    \"searchable\": [      \"SimpleStorage\"    ],    \"source\": \"contract SimpleStorage { uint storedData; function set(uint x) { storedData = x; } function get() returns (uint retVal) { return storedData; } }\"  }]"
```

Once the contract is indexed with Cirrus, you can now search for instances of the contract with the `/search/{contractName}` endpoint.

```bash
curl -X GET "http://localhost/bloc/v2.1/search/SimpleStorage" -H  "accept: application/json;charset=utf-8"
```

The response is an array with the address of all SimpleStorage contracts.
```bash
[
  "ea5e32eff6edcfa1da15a124b73c6995096799a7"
]
```

To perform a query on this contract, we first need to know what variables are available in the contract.

```bash
curl -X GET "http://localhost/cirrus/search/SimpleStorage" -H  "accept: application/json;charset=utf-8"
```

Response
```JSON
[{
  "address":"ea5e32eff6edcfa1da15a124b73c6995096799a7",
  "x":0
}]
```

Here we can see that the variables `x` and `address` are ones we could query.

Let's try to form our query now. We will query for contracts with `x` `=` to `0`. The format of this request is `variable=operator.value` so `x` is our variable, `=` is our operator, and `0` is the value. Don't forget the `?` after `/cirrus/seach/{contractName}`

```bash
curl -X GET "http://localhost/cirrus/search/SimpleStorage?x=eq.0"
```

Response
```JSON
[{
  "address":"ea5e32eff6edcfa1da15a124b73c6995096799a7",
  "x":0
}]
```

Finally, let's try one last example. Now I want to query for all contracts where `x != 100`.

```bash
curl -X GET "http://localhost/cirrus/search/SimpleStorage?x=neq.100"
```

Response
```JSON
[{
  "address":"ea5e32eff6edcfa1da15a124b73c6995096799a7",
  "x":0
}]
```

Happy Querying!
