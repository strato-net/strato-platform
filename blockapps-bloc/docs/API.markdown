# Addresses

## GET /addresses
This end-point returns a list of all addresses from the app/users folder.

This call is non blocking.


#### Response:

- Status code 200
- Headers: []

- Supported content types are:

    - `text/html;charset=utf-8`

#### Expected Response (But this is not what we get)

```html
[]
```

-

```html
["000000000000deadbeef"]
```

-

```html
["000000000000deadbeef","000000000000deadbeef"]
```

-

```html
["00000000000012345678"]
```

-

```html
["000000000000deadbeef","000000000000deadbeef","000000000000deadbeef"]
```

## GET /addresses/:address/pending
This call is expected to return details for a user account pending confirmation.

This call is non blocking.

#### Captures

- *address*: User account address previously returned by Bloc.

#### Response

Unknown

## GET /addresses/:address/pending/remove/:time
This call is expected to return details for a user account pending confirmation.

This call is non blocking.

#### Captures

- *address*: User account address previously returned by Bloc.
- *time*: The unix time stamp for the request (obtained from the GET /addresses/:address/pending call)

#### Response

Unknown

# Contract

## GET /contracts
This returns a list of contracts along with their creation timestamps.

This call is non blocking.


#### Response:

- Status code 200
- Headers: []

- Supported content types are:

    - `application/json`

- Response body as below.

```javascript
{"Address":[{"createdAt":1484957995000,"address":"309e10eddc6333b82889bfc25a2b107b9c2c9a8c"},{"createdAt":1485193000000,"address":"Addressed"}]}
```

## GET /contracts/:contractName
This returns a list of addresses for the given contract name.

This call is non blocking.


#### Captures:

- *contractName*: a contract name

#### Response:

- Status code 200
- Headers: []

- Supported content types are:

    - `application/octet-stream`

-

```
[]
```

-

```
["000000000000deadbeef"]
```

-

```
["000000000000deadbeef","000000000000deadbeef"]
```

-

```
["00000000000012345678"]
```

-

```
["000000000000deadbeef","000000000000deadbeef","000000000000deadbeef"]
```

## GET /contracts/:contractName/:contractAddress\.:extension?
This call shows the contract details for the given contract address.

This call is non blocking.


#### Captures:

- *contractName*: a contract name
- *contractAddress*: a contract address
- *extension*: extension for the response expected? The only value the code is looking for is `html`. If the extension is `html`, the response includes some frontend JS code.

#### Response

```javascript
{
  "bin": "606060405260206040519081016040528060008152602001506001600050...0508156",
  "bin-runtime": "60606040526000357......................68201915b50505050508156",
  "codeHash": "9a15f6fd4ff8396f006d7234b054bc73ebc9f0245ff53500d0ca6c2a54fa272c",
  "xabi": {
    "funcs": {
      "increment": {
        "args": {},
        "selector": "d09de08a",
        "vals": {
          "#0": {
            "type": "Int",
            "index": 0,
            "bytes": 32
          }
        }
      }
    },
    "constr": {
      "_id": {
        "dynamic": true,
        "type": "String",
        "index": 0,
        "name": "_id"
      }
    },
    "vars": {
      "value": {
        "atBytes": 64,
        "type": "Int",
        "bytes": 32
      },
      "busyList": {
        "atBytes": 0,
        "dynamic": true,
        "entry": {
          "typedef": "Busy",
          "type": "Contract",
          "bytes": 20
        },
        "type": "Array"
      },
      "id": {
        "atBytes": 32,
        "dynamic": true,
        "type": "String"
      }
    }
  },
  "name": "BusyWork",
  "address": "a248737a9eda29869825f6701a6930699e11fc27"
}
```

## GET /contracts/:contractName/:contractAddress/functions
This call returns a list of functions in this contract.

This call is non blocking 

#### Captures

- *contractName*: a contract name
- *contractAddress*: a contract address

#### Response

-

```javascript
["increment"]
```

-

```javascript
["functionCall1","functionCall2"]
```

## GET /contracts/:contractName/:contractAddress/symbols
This call returns a list of symbols in this contract.

This call is non blocking 

#### Captures

- *contractName*: a contract name
- *contractAddress*: a contract address

#### Response

-

```javascript
["value","busyList","id"]
```

-

```javascript
["variable1","variable2"]
```

## GET /contracts/:contractName/:contractAddress/state
This call returns the current state of the contract (values of all the symbols and functions).

#### Backend Calls

#### Captures

- *contractName*: a contract name
- *contractAddress*: a contract address

#### Response

```javascript
{
  "increment": "function () returns (Int)",
  "value": "180",
  "busyList": [
    "40390397d98a3b864398c3d33246f46d5de13fb5",
    "a713e44725c42c4dcf719be0ff04688461cec31a",
    "f04d217de5ba796144b960fe92ce07c0ae85794c"
  ],
  "id": "UID_29892_31308598"
}
```

## GET /contracts/:contractName/:contractAddress/state/:mapping/:key
This call returns specfic values from a solidity mapping in a contract.

This call is non blocking.

#### Captures

- *contractName*: a contract name
- *contractAddress*: a contract address
- *mapping*: the symbol name representing the map
- *key*: the key for the desired value

#### Response

```javascript
//http://tester12.westus.cloudapp.azure.com/bloc/contracts/SimpleMapping/d1d29ee74a6d03244189ddb39239adc2a5f77ba91a8df459f17a172dbd96213d/state/m/1

{
  "m": {
    "1": {
      "type": "Buffer",
      "data": []
    }
  }
}
```

## GET /contracts/:contractName/all/states/
This call returns the current state of all contracts with the *:contractName*.

#### Captures

- *contractName*: a contract name

#### Response

See _GET /contracts/:contractName/:contractAddress/state_. This call returns the same information in an array.

## POST /contracts/compile
This call accepts an array of contract sources as its request body and returns an array of contract names and their code hashes.

#### Backend Calls
This call blocks on the following backend calls:
- `strato-api/eth/v1.2/solc` or `strato-api/eth/v1.2/extabi`, depending on wether this is called with the source or the source object.
- If the contracts is searchable, it posts the contract to cirrus.

#### Request

```javascript
Content-Type: application/json

[
	{
		"searchable": ["SimpleStorage"],
		"contractName": "SimpleStorage",
		"source": "contract SimpleStorage {    uint storedData;    function set(uint x) {        storedData = x;    }    function get() returns (uint retVal) {        return storedData;    }}"
	}
]
```

#### Response

```javascript
[
  {
    "contractName": "SimpleStorage",
    "codeHash": "989ad6524e83e1a38b485bb898d27b5dbc65fc33905c3d3a2fd41c5bb91c3fc8"
  }
]

```

# Users

## GET /users
Returns a list of all users that bloc is aware of.

This call is non blocking.

#### Response:

- Status code 200
- Headers: []

- Supported content types are:

    - `text/html;charset=utf-8`

-

```html
[]
```

-

```html
["samrit"]
```

-

```html
["samrit","samrit"]
```

-

```html
["eitan"]
```

-

```html
["samrit","samrit","samrit"]
```

## GET /users/:user
This returns a list of known addresses for the provided username. This call is non blocking.


#### Captures:

- *user*: a user name

#### Response:

- Status code 200
- Headers: []

- Supported content types are:

    - `text/html;charset=utf-8`

-

```javascript
[]
```

-

```javascript
["000000000000deadbeef"]
```

-

```javascript
["000000000000deadbeef","000000000000deadbeef"]
```

-

```javascript
["00000000000012345678"]
```

-

```javascript
["000000000000deadbeef","000000000000deadbeef","000000000000deadbeef"]
```

## POST /users/:user
This creates a new user with the provided user name

#### Backend Call
This call blocks on the `strato-api/eth/v1.2/faucet` call.

#### Captures:

- *user*: a user name

#### Request:

- Supported content types are:

    - `application/x-www-form-urlencoded`

- Example: `application/x-www-form-urlencoded`

```
faucet=1&password=securePassword
```

#### Response:

- Status code 200
- Headers: []

- Supported content types are:

    - `text/html;charset=utf-8`

-

```html
000000000000deadbeef
```

-

```html
00000000000012345678
```

## POST /users/:user/:address/contract

This call allows a user to upload a sincle contracts.

#### Backend Calls
This call block on  `strato-api/eth/v1.2/solc`.

#### Captures:

- *user*: a user name
- *address*: an Ethereum address

#### Request:

- Supported content types are:

    - `application/x-www-form-urlencoded`

- Example: `application/x-www-form-urlencoded`

```
password=securePassword&src=contract%20SimpleStorage%20%7B%20uint%20storedData%3B%20function%20set%28uint%20x%29%20%7B%20storedData%20%3D%20x%3B%20%7D%20function%20get%28%29%20returns%20%28uint%20retVal%29%20%7B%20return%20storedData%3B%20%7D%20%7D
```

#### Response:

- Status code 200
- Headers: []

- Supported content types are:

    - `application/json`

-

```javascript
"4fbe47914a102ae6561597c95ab95819ddfd6b18c7abc3004c099aeaed2234b4"
```

-

```javascript
"b4c9eaf404872994677d9def95dee3fe36bfbcd9be2312670ef7be131a502f32"
```

-

```javascript
"ff35fbab09d19d5c3d4d457d9084fdba3dfc43a3381062b832f561040b37c871"
```

-

```javascript
"edc75d89745d355ec53c70a580afd905f28b3ee2027975afcf25e859322c829e"
```

-

```javascript
"ed17f216c16a13951965ab89cd89616a856c3fc2ee714ec1a532d6aef36cec1c"
```

## POST /users/:user/:address/import

This call is similar to the _/users/:user/:address/contract_ call but it uses a JSON object instead of the contract source code string. This end point is not completely functional.

#### Expected Behavior
This should accept JSON that covers all the needed files for the import dependencies to be satisfied. JSON would probably contain files as a hashmap with path + filename as key and the file contents as the value.

#### Backend Calls
This call block on  `strato-api/eth/v1.2/extabi`.

#### Captures:

- *user*: a user name
- *address*: an Ethereum address

#### Response:
This call is currently not being used. 

## POST /users/:user/:address/uploadList
This call is used to upload a list of previously compiled contracts (see _/contracts/compile_).

#### Backend Calls
This call block on  `strato-api/eth/v1.2/solc`.

#### Captures:

- *user*: a user name
- *address*: an Ethereum address

#### Request

```javascript
{
	"password": "1234",
	"resolve": "true",
	"contracts": [
		{
			"contractName": "SimpleStorage",
			"args": {}
		}
	]
}
```

#### Response

```javascript
[
  {
    "contractJSON": "{\"bin\":\"606060405260978060106000396000f360606040526000357c01000000000000000000000000000000000000000000000000000000009004806360fe47b11460415780636d4ce63c14605757603f565b005b605560048080359060200190919050506078565b005b606260048050506086565b6040518082815260200191505060405180910390f35b806000600050819055505b50565b600060006000505490506094565b9056\",\"bin-runtime\":\"60606040526000357c01000000000000000000000000000000000000000000000000000000009004806360fe47b11460415780636d4ce63c14605757603f565b005b605560048080359060200190919050506078565b005b606260048050506086565b6040518082815260200191505060405180910390f35b806000600050819055505b50565b600060006000505490506094565b9056\",\"codeHash\":\"989ad6524e83e1a38b485bb898d27b5dbc65fc33905c3d3a2fd41c5bb91c3fc8\",\"xabi\":{\"funcs\":{\"set\":{\"args\":{\"x\":{\"type\":\"Int\",\"index\":0,\"bytes\":32,\"name\":\"x\"}},\"selector\":\"60fe47b1\",\"vals\":{}},\"get\":{\"args\":{},\"selector\":\"6d4ce63c\",\"vals\":{\"retVal\":{\"type\":\"Int\",\"index\":0,\"bytes\":32}}}},\"vars\":{\"storedData\":{\"atBytes\":0,\"type\":\"Int\",\"bytes\":32}}},\"name\":\"SimpleStorage\",\"address\":\"40453f2cf0e76c1be5abab998e7e7392acd7f80e\"}"
  }
]
```

## POST /users/:user/:address/send
This call is used to send ether to another address.

#### Backend Calls
This route blocks on the `strato-api/eth/v1.2/transaction` call.

#### Captures:

- *user*: a user name
- *address*: an Ethereum address

#### Request:

- Supported content types are:

    - `application/x-www-form-urlencoded`

- Example: `application/x-www-form-urlencoded`

```
toAddress=000000000000deadbeef&value=10&password=securePassword
```

#### Response:

- Status code 200
- Headers: []

- Supported content types are:

    - `text/html;charset=utf-8`

- Response body as below.

```html
{"hash":"4fbe47914a102ae6561597c95ab95819ddfd6b18c7abc3004c099aeaed2234b4","gasLimit":"21000","codeOrData":"","gasPrice":"50000000000","to":"000000000000deadbeef","value":"10000000000000000000","from":"111dec89c25cbda1c12d67621ee3c10ddb8196bf","r":"1","s":"1","v":"1c","nonce":"0"}
```

## POST /users/:user/:userAddress/sendList
This call is used to batch multiple ether transfers into a single API call.

#### Backend Calls
This route blocks on the `strato-api/eth/v1.2/transaction` call.

#### Captures:

- *user*: a user name
- *address*: an Ethereum address

#### Request

```javascript
{
	"password": "1234",
	"resolve": true,
	"txs": [
		{
			"toAddress": "eac05b64528acad20b6dcd48da763d2487c8e905", 
			"value": 100
		},
		{
			"toAddress": "eac05b64528acad20b6dcd48da763d2487c8e905", 
			"value": 100
		},
		{
			"toAddress": "eac05b64528acad20b6dcd48da763d2487c8e905", 
			"value": 100
		}
	]
}
```

#### Response
```javascript
[
  {
    "senderBalance": "999999999999911419598"
  },
  {
    "senderBalance": "999999999999911419598"
  },
  {
    "senderBalance": "999999999999911419598"
  }
]
```

## POST /users/:user/:userAddress/contract/:contractName/:contractAddress/call

This call is used to make Solidity function call against a deployed contract.

#### Backend Calls

This end point blocks on the `strato-api/eth/v1.2/transaction` call.

#### Captures:

- *user*: a user name
- *userAddress*: an Ethereum address
- *contractName*: a contract name
- *contractAddress*: an Ethereum address

#### Request

```javascript
// POST /users/Admin_51899_20511857248/d2b381613722d7e30e334e2aa45dde8236d1856d/contract/BusyWork/64eb79d62cd19923c126e3d6b796270dea0689d5/call

{
	"password": "1234",
	"method": "increment",
	"args": {},
	"value": 0
}
```

#### Response:

- Status code 200
- Headers: []

- Supported content types are:

    - `application/json`

- Response body as below.

```javascript
transaction returned: 1
```
## POST /users/:user/:address/callList
This end point is used to batch multiple calls to Solidity functions against deployed contracts.

#### Backend Calls

This end point blocks on the `strato-api/eth/v1.2/transaction` call.

#### Captures:

- *user*: a user name
- *userAddress*: an Ethereum address

#### Request

```javascript
{
	"password": "1234",
	"resolve": "true",
	"txs": [
		{
			"contractName": "BusyWork",
			"contractAddress": "a248737a9eda29869825f6701a6930699e11fc27",
			"methodName": "increment",
			"args": {},
			"value": 0			
		},
		{
			"contractName": "BusyWork",
			"contractAddress": "a248737a9eda29869825f6701a6930699e11fc27",
			"methodName": "increment",
			"args": {},
			"value": 0			
		}
	]
	
}
```

#### Response

```javascript
[
  {
    "returnValue": "181"
  },
  {
    "returnValue": "182"
  }
]
```

# Search

## GET /search/:contractName

This call returns a collection of contract addresses, similar to _GET /contracts/:contractName_. 

This call is non blocking.

#### Captures

- *contractName*: Name of the contract

#### Response

```javascript
["Busy","BusyWork","Latest","a248737a9eda29869825f6701a6930699e11fc27"]
```


## GET /search/:contractName/state

This call returns the state for all contracts found with the same name, similar to _GET /contracts/all/states_.

#### Backend Calls

This call blocks on a call to `strato-api/eth/v1.2/accounts?codehash=:codeHash`.

#### Captures

- *contractName*: Name of the contract

#### Response

```javascript
[
  {
    "address": "64eb79d62cd19923c126e3d6b796270dea0689d5",
    "state": {
      "increment": "function () returns (Int)",
      "value": "0",
      "busyList": [],
      "id": "unused"
    }
  },
  {
    "address": "a248737a9eda29869825f6701a6930699e11fc27",
    "state": {
      "increment": "function () returns (Int)",
      "value": "180",
      "busyList": [
        "40390397d98a3b864398c3d33246f46d5de13fb5",
        "a713e44725c42c4dcf719be0ff04688461cec31a",
        "f04d217de5ba796144b960fe92ce07c0ae85794c"
      ],
      "id": "UID_29892_31308598"
    }
  }
]
```


## GET /search/:contractName/state/reduced

This call is used to return values for specific symbols for all contracts that match the _contractName_.


#### Backend Calls

This call blocks on a call to `strato-api/eth/v1.2/accounts?codehash=:codeHash`.


#### Captures

- *contractName*: name of the contract.

#### Response
- _/search/:contractName/state/reduced?props=id_

```javascript
[
  {
    "address": "64eb79d62cd19923c126e3d6b796270dea0689d5",
    "state": {
      "id": "unused"
    }
  },
  {
    "address": "a248737a9eda29869825f6701a6930699e11fc27",
    "state": {
      "id": "UID_29892_31308598"
    }
  }
]
```
- _/search/:contractName/state/reduced?props=id&props=value_

```javascript
[
  {
    "address": "64eb79d62cd19923c126e3d6b796270dea0689d5",
    "state": {
      "id": "unused",
      "value": "0"
    }
  },
  {
    "address": "a248737a9eda29869825f6701a6930699e11fc27",
    "state": {
      "id": "UID_29892_31308598",
      "value": "180"
    }
  }
]
```

## GET /search/:contractName/state/summary

This end point is currently returning 502 Bad Gateway in the latest builds.


#### Backend Calls

This call blocks on a call to `strato-api/eth/v1.2/accounts?codehash=:codeHash`.

#### Captures

- *contractName*: name of the contract.

#### Response

Unknown
