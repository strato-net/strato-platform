# Addresses

## GET /addresses
This end-point currently redirects to explorer. It should return a list of all addresses from the app/users folder.

This call is non blocking.

#### Backend Calls:
This end point does not use any backend calls.

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

#### Backend Calls

This call does not make any backend calls.

#### Response

Unknown

## GET /addresses/:address/pending/remove/:time
This call is expected to return details for a user account pending confirmation.

This call is non blocking.

#### Captures

- *address*: User account address previously returned by Bloc.
- *time*: The unix time stamp for the request (obtained from the GET /addresses/:address/pending call)

#### Backend Calls

This call does not make any backend calls.

#### Response

Unknown

# Contract

## GET /contracts



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

## GET /users



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



#### Captures:

- *user*: a user name

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

## POST /users/:user



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

## POST /users/:user/:address/send



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

## POST /users/:user/:userAddress/contract/:contractName/:contractAddress/call



#### Captures:

- *user*: a user name
- *userAddress*: an Ethereum address
- *contractName*: a contract name
- *contractAddress*: an Ethereum address

#### Response:

- Status code 200
- Headers: []

- Supported content types are:

    - `application/json`

- Response body as below.

```javascript

```
## Missing API Calls
1. user: uploadList
2. user: import
3. user: callList
4. user: sendList
5. contract: state
6. contract
7. contract state lookup
8. compile
9. search
10. search reduced
