## Endpoints

There are three REST endpoints, corrensponding to the query of a block, address and a transaction, respectively.

All of these queries can be appended with `page=n` for pageing. Pageing starts at 0 so `/query?block=xxxx` is equivalent to `/query?block=xxxx&page=0`. For blocks we support indexing. If you want to query a large range, supply `index=n` where `n-1` is the last block that you queried. This will supersede paging eventually for all queries.

###  ```/query/block?```

- `number`, `maxnumber`, `minnumber`
- `nonce`, `maxnonce`, `minnonce`
- `gas`, `maxgas`, `mingas`   
- `gaslim`, `maxgaslim`, `mingaslim`
- `gasused`, `maxgasused`, `mingasused`
- `diff`, `maxdiff`, `mindiff`
- `txaddress`
- `coinbase`
- `blockid`

### ```/query/account?```

- `balance`, `minbalance`, `maxbalance`  
- `nonce`, `minnonce`, `maxnonce` 
- `address` 
    
### ```/query/transaction?```
- `from`, `to`, `address`
- `blockid`
- `value`, `maxvalue`, `minvalue`
- `gasprice`, `maxgasprice`, `mingasprice`
- `gaslimit`, `maxgaslimit`, `mingaslimit`

## There are also fixed endpoints (to be deprecated)

Pages (where supported) start from 0 and are appended to the string in the end, like `/query/block?address=xxx/2`. This will eventually move into the general query string. They are optional.

- `/query/block/txaddress/xxxxxxxx` or `/query/block/txaddress/xxxxxxxx/2`
- `/query/block/coinbase/xxxxxxxx` or `/query/block/coinbase/xxxxxxxx/5`
- `/query/account/address/xxxxxxx` or `/query/account/address/xxxxxxx/12`
- `/query/transaction/address/xxxxxxx` or `/query/transaction/address/xxxxxxx/0`

- `/query/block/blockrange/lower/n1/upper/n2/` or `/query/block/blockrange/lower/n1/upper/n2/12`
- `/query/block/numberrange/lower/n1/upper/n2/` or `/query/block/numberrange/lower/n1/upper/n2/12`

## Types of transactions

### FunctionCall

If `toAddress == Null` and `len(code) > 0` we have a `FunctionCall`.

### Contract

If `toAddress != Null` and `len(code) >= 0` we have a `Contract`.

### Transaction

If `toAddress != Null` and `len(code) == 0` we have a `Transaction`.