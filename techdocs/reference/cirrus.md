# Cirrus (Indexed Contract Data)

Cirrus is how you query contract data on STRATO with SQL-style filters. Every node runs:

- **slipstream**, which reads SolidVM execution output and writes contract state, mappings and events to the Postgres `cirrus` database;
- **PostgREST** (v12), which serves that database read-only over HTTP at `/cirrus/search`.

Use Cirrus to list contracts, read state across many instances, search mappings such as token balances, and read event and state history. For one contract's live state you can also use the [Bloc API](strato-node-api.md#contracts). For Ethereum-style log queries, see [JSON-RPC](json-rpc.md).

## Endpoint

```
GET https://app.strato.nexus/cirrus/search/<table>
GET https://app.testnet.strato.nexus/cirrus/search/<table>
```

- **GET only.** nginx rejects other methods.
- **No token needed.** Anonymous reads are allowed.
- Rows come back as a JSON array. An unknown table returns `404` with PostgREST error code `42P01`. `/cirrus/search/` with no table returns `403`.
- **Always pass `limit`.** The server caps a response at 1,000,000 rows, so an unfiltered query on a large table returns a very large response.

## Table Naming

Table names include `-` and `@`. Use them unchanged in the URL path.

| Table | Name | Example |
|-------|------|---------|
| Contract state | `<creator>-<Contract>` | `BlockApps-Token` |
| Mapping or array variable | `<creator>-<Contract>-<variable>` | `BlockApps-Token-_balances` |
| Event | `<creator>-<Contract>-<Event>` | `BlockApps-Token-Transfer` |
| Array parameter of an event | `<creator>-<Contract>-<Event>-<parameter>` | |
| All contract storage (JSON) | `storage` | |
| All mapping entries (JSON) | `mapping` | |
| All events (JSON) | `event` | |
| State history | `history@storage` | |
| Mapping history | `history@mapping` | |

- `<creator>` is the name recorded with the contract's code when it was uploaded. Platform contracts deployed at genesis use `BlockApps`.
- **Parent contracts have tables too.** Querying a parent contract's table returns every contract that inherits from it. For example, `BlockApps-ERC20` returns `Token` rows, and the `contract_name` column tells you the concrete contract.
- **Proxied contracts** appear in their logic contract's table. USDST at `937efa7e3a77e20bbdbd7c0d32b6514f368c1010` is a `Proxy` account, but its row is in `BlockApps-Token`.
- Postgres limits identifiers to 63 characters, so very long table names are truncated.

!!! note "Changes from older STRATO versions"
    Contract tables no longer have `chainId`, `record_id`, `transaction_hash` or `transaction_sender` columns. There are no per-contract `history@<Contract>` tables: history lives in `history@storage` and `history@mapping`. `indexed@` event tables are no longer created.

## Columns

### Contract tables

| Column | Notes |
|--------|-------|
| `address` | Contract address (40 hex characters, no `0x`) |
| `block_hash`, `block_number`, `block_timestamp` | Block of the last update. `block_number` is text. `block_timestamp` looks like `2026-09-13 19:39:10 UTC`. |
| `creator` | Table-name prefix, such as `BlockApps` |
| `contract_name` | Concrete contract name |
| one column per state variable | Named as in the source, such as `_name`, `_symbol`, `_totalSupply` |

```json
{
  "address": "000000000000000000000000000000000000100f",
  "block_hash": "ad2a825bb4ca6a2937e51d5ed2fe4d4559af5214783d9609bdcf158f4be84eb7",
  "block_timestamp": "2026-09-13 19:39:10 UTC",
  "block_number": "558986",
  "creator": "BlockApps",
  "contract_name": "Token",
  "_name": "lendUSDST",
  "_symbol": "lendUSDST",
  "_totalSupply": 211633657347554922364834,
  "customDecimals": 18
}
```

### Mapping and array tables

Columns:

- `address`, `block_hash`, `block_number`, `block_timestamp`
- `collection_name`, `collection_type` (for example `Mapping`)
- `key`, plus `key2`, `key3`, ... for nested mappings
- `value`

If the value is a struct, its fields appear as columns in place of `value`. Entries whose value is null, `0`, `false` or an empty string are left out.

### Event tables

Columns:

- `id`
- `address`, `block_hash`, `block_number`, `block_timestamp`
- `transaction_hash`, `transaction_sender`, `event_index`
- `creator`, `contract_name`
- one column per event parameter

The global `event` table has `event_name` and `attributes` (a JSON object) in place of per-parameter columns.

### History tables

`history@storage` has a row for each version of a contract's storage: `address`, block columns, `data` (JSON), `valid_from` and `valid_to`.

`history@mapping` has a row for each version of a mapping entry: `address`, `collection_name`, `key` (JSON, such as `{"key": "<address>"}`), `path`, `value`, `valid_from` and `valid_to`.

The current version has `valid_to` set to `infinity`.

### Reserved column names

Cirrus uses these names for its own columns and does not rename clashing variables:

- **All tables:** `address`, `block_hash`, `block_number`, `block_timestamp`, `creator`, `contract_name`
- **Event tables:** `id`, `transaction_hash`, `transaction_sender`, `event_index`
- **Collection tables:** `collection_name`, `collection_type`, `key`, `key2`, ..., `value`

Don't give state variables or event parameters these names if you want to query them in Cirrus.

!!! warning "Large numbers"
    `uint` values are returned as JSON numbers and are often larger than 2^53. Standard `JSON.parse` in JavaScript loses precision on them. Use a big-number-safe JSON parser.

## Query Syntax

Cirrus uses [PostgREST](https://docs.postgrest.org/en/v12/) query parameters. The most common:

| Purpose | Syntax | Example |
|---------|--------|---------|
| Choose columns | `select=` | `select=address,_name,_symbol` |
| Filter | `<column>=<op>.<value>` | `_symbol=eq.USDST` |
| Operators | `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `like`, `ilike`, `in`, `is` | `_symbol=in.(USDST,GOLDST)` |
| Pattern match | `*` is the wildcard | `_symbol=ilike.*ust*` |
| Negate | `not.` prefix | `status=not.eq.3` |
| OR / AND | `or=(...)`, `and=(...)` | `or=(_symbol.eq.USDST,_symbol.eq.GOLDST)` |
| JSON fields | `->` and `->>` | `key->>key=eq.<address>` |
| Sort | `order=<column>.asc` or `.desc` | `order=block_timestamp.desc` |
| Page | `limit=`, `offset=` | `limit=50&offset=100` |
| Total count | `Prefer: count=exact` header | The total is in `Content-Range` (`0-0/979`) |

!!! tip
    `block_number` is stored as text, so ordering or range filters on it compare strings. Order events by `id`, and contract rows by `block_timestamp`.

## Examples

All of these were run against testnet. Change the host to query mainnet. USDST has the same address on both networks.

**List tokens**

```bash
curl -s "https://app.testnet.strato.nexus/cirrus/search/BlockApps-Token?select=address,_name,_symbol&limit=3"
```

```json
[
  {"address":"000000000000000000000000000000000000100f","_name":"lendUSDST","_symbol":"lendUSDST"},
  {"address":"0000000000000000000000000000000000001016","_name":"safetyUSDST","_symbol":"safetyUSDST"},
  {"address":"0000000000000000000000000000000000001018","_name":"ETH-USDST LP Token","_symbol":"ETH-USDST-LP"}
]
```

**Find tokens by symbol**

```bash
curl -s -g "https://app.testnet.strato.nexus/cirrus/search/BlockApps-Token?select=address,_symbol&or=(_symbol.eq.USDST,_symbol.eq.GOLDST)"
```

**All non-zero token balances for one account**

```bash
curl -s "https://app.testnet.strato.nexus/cirrus/search/BlockApps-Token-_balances?select=address,key,value&key=eq.0dbb9131d99c8317aa69a70909e124f2e02446e8&value=gt.0"
```

In each row, `address` is the token contract and `key` is the holder.

**Largest USDST holders**

```bash
curl -s "https://app.testnet.strato.nexus/cirrus/search/BlockApps-Token-_balances?address=eq.937efa7e3a77e20bbdbd7c0d32b6514f368c1010&select=key,value&order=value.desc&limit=2"
```

**Latest token transfers**

```bash
curl -s "https://app.testnet.strato.nexus/cirrus/search/BlockApps-Token-Transfer?select=id,block_number,address,from,to,value&order=id.desc&limit=5"
```

**Balance history for one holder**

```bash
curl -s -g "https://app.testnet.strato.nexus/cirrus/search/history@mapping?address=eq.937efa7e3a77e20bbdbd7c0d32b6514f368c1010&collection_name=eq._balances&key->>key=eq.1b7dc206ef2fe3aab27404b88c36470ccf16c0ce&select=value,valid_from,valid_to&order=valid_from.desc&limit=5"
```

**Count rows**

```bash
curl -s -o /dev/null -D - -H "Prefer: count=exact" \
  "https://app.testnet.strato.nexus/cirrus/search/BlockApps-Token?select=address&limit=1" | grep -i content-range
```

!!! tip "curl and brackets"
    Pass `-g` to curl when a URL contains `(`, `)`, `[` or `]`, so curl doesn't treat them as glob patterns.

## Related Docs

- [Core Platform API](strato-node-api.md): blocks, transactions, Bloc contract state
- [JSON-RPC](json-rpc.md): `eth_getLogs` and other Ethereum-style reads
- [Transactions & Fees](../platform/transactions-and-fees.md)
