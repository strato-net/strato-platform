# solidity-abi

A partial Solidity parser that emits a JSON object describing the
top-level definitions in a Solidity file.

This version is compatible with solc-0.2.0.

## Usage

```sh
# Command-line
solidity-abi (main-file.sol import1.sol ... | --stdin)
```
```haskell
-- Haskell
import Blockchain.Ethereum.Solidity.Layout
import Blockchain.Ethereum.Solidity.Parse            
import Blockchain.Ethereum.Solidity.External.JSON    
import Blockchain.Ethereum.Solidity.External.Contract
```

This object (the "ABI") has the following structure:

### File level
```js
file = {
  "contract name" : contract,
  ...
}
```

## JSON output structure

Both the `jsonABI` Haskell function or the `solidity-abi` executable
produce JSON of the following form

### Contract level
```js
contract = {
   "vars" : {
     "var name" : variable (visible externally)
     ...
   },
   "funcs" : {
     "func name" : function (visible externally),
     ...
   },
   "types" : {
     "type name" : type defn,
     ...
   },
   "constr" : function args
}
```
where any of the fields, if empty, is omitted.

### State variables

The short version is that a variable contains, in addition to the
"atBytes" field shown below, a "type" field describing its general
category; a "bytes" field describing its byte usage, if applicable; a
"dynamic" field if it is of dynamic length; an "entry" field
describing its entries, if it is an array; and a few type-specific
fields as shown below.

```js
variable = {
  "atBytes" : decimal number (byte position in storage),
  basic type ABI
}
basic type ABI = {
  // intN
  "type" : "Int",
  "signed" : true,
  "bytes" : decimal number (= N/8; byte length)
  // uintN
  "type" : "Int",
  "bytes" : decimal number (= N/8; byte length)
  // bytesN
  "type" : "Bytes",
  "bytes" : decimal number (= N; byte length)
  // bytes
  "type" : "Bytes",
  "dynamic" : true
  // string
  "type" : "String",
  "dynamic" : true
  // T[n]
  "type" : "Array",
  "length" : decimal number (= n; number of entries)
  "entry" : basic type ABI of T
  // T[]
  "type" : "Array",
  "dynamic" : true,
  "entry" : basic type ABI of T
  // mapping(keyT => valT)
  "type" : "Mapping",
  "dynamic" : true,
  "key" : basic type ABI of keyT,
  "value" : basic type ABI of valT
  // name
  "typedef" : name (identifier of user-defined type)
}
```

### Functions
```js
function = {
  "selector" : 4-byte hex string (the "function selector"),
  "args" : function args
  "vals" : function args
}
function args = {
  "arg name" : {
    "index" : decimal integer (place in argument list),
    basic type ABI
  },
  "#n" : {
    "index" : decimal integer (= n, only if this arg is unnamed),
    basic type ABI
  },
  ...
}
```

### Types

```js
type defn = {
  // struct
  "type" : "Struct",
  "fields" : {
    "field name" : variable,
    ...
  }
  // enum
  "type" : "Enum",
  "bytes" : decimal integer (smallest number of bytes holding all values),
  "names" : ["named value", ... ]
  // "using"
  "type" : "Using",
  "usingContract" : string (contract name),
  "usingType" : string (type name within the contract)
}
```
