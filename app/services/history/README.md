# App history service

Phase 7 of the tiered deployment. Time-series data the app's charts want
(oracle prices, pool swaps, token balances over time), indexed into this
service's own Postgres so heavy chart queries never touch the node's
replicas, and served as compact, cacheable JSON.

## Feeds

- **Bus** (`BUS_HOST`): consumes `chain_events` from the shared message bus
  (phase 4), one event per message, seconds after the block. Group
  `HISTORY_CONSUMER_GROUP` (default `history`) shared by all copies.
- **Cirrus poller** (`NODE_URL`): pages the node's global `event` table by id
  from where it left off. On first start that is the backfill from genesis;
  afterwards it trails the bus by one poll and fills anything the bus feed
  missed (a broker outage, a message older than retention).

Both feeds write through one serialised apply step. Every row is keyed by
chain position and inserted with `ON CONFLICT DO NOTHING`; current balances,
daily snapshots and candles advance only from rows that were new. So the two
feeds overlap freely, arrive in any order, and a replay changes nothing.

Events handled, keyed by name and argument shape (never by contract name,
which collides across code collections):

| Event | Rows |
|---|---|
| `Transfer(from|sender, to|receiver, value|amount)` | `balance_changes` (two legs), `balances_current`, `balance_snapshots_daily` |
| `PriceUpdated(asset, price, timestamp)` | `price_observations`, `ohlc` series `oracle:<asset>` |
| `BatchPricesUpdated(assets[], priceValues[], timestamp)` | one observation per element |
| `Swap(sender, tokenIn, tokenOut, amountIn, amountOut)` | `swaps`, `ohlc` series `pool:<pool>:<tokenIn>:<tokenOut>` (price = amountOut/amountIn) |

PoolV3's `Swap(amount0, amount1, sqrtPriceX96, ...)` is counted as ignored
for now.

## API

All under `/history-api`, anonymous, with `Cache-Control: public, max-age`
tuned per resolution (30 s for 1m, 5 min for 1h, 1 h for 1d) so CloudFront
and browsers absorb repeat loads.

- `GET /prices/:asset?resolution=1m|1h|1d&from=&to=` candles `[t, o, h, l, c, volume, count]`
- `GET /prices/:asset/latest`
- `GET /pools/:pool/ohlc?tokenIn=&tokenOut=&resolution=&from=&to=`
- `GET /pools/:pool/swaps?from=&to=&limit=`
- `GET /balances/:account?token=&from=&to=` one point per day, carried forward
- `GET /balances/:account/current[?token=]`
- `GET /status` feed progress, `GET /health`

Numerics are strings (uint256 does not fit a JSON number). Times are ISO
8601 or epoch seconds.

## Storage

Postgres, its own database (`HISTORY_DB_NAME`, created on first start).
`price_observations`, `swaps` and `balance_changes` are partitioned by month
on block time; the indexer creates partitions as it goes.

## Running

```
postgres_host=... postgres_password=... NODE_URL=https://app.example \
BUS_HOST=... BUS_SASL_USERNAME=... BUS_SASL_PASSWORD=... npm start
```

`npm test` runs the feed-independent checks (no database needed).
