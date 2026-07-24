# RWA.io Adapter

Sidecar service that periodically pushes STRATO financial metrics to the [RWA.io](https://rwa.io) time-series API. It publishes two kinds of series each hour:

- **Project-level** (`slug=strato`) — the STRATO chain / project token: `price` and `marketCap` from the STRATO token (`config.strato.projectTokenAddress`), plus platform-wide `tvl`, `aum`, and `totalVolume`. AUM currently mirrors TVL (the only chain-wide assets-under-management figure STRATO exposes). See `src/projectMetrics.ts`.
  - `dailyTransactions` and `uniqueWallets` (`count` units) are computed directly from the STRATO node REST API (`config.strato.ethApiBaseUrl`) — a trailing-24h transaction count and distinct-sender count. See `src/chainActivity.ts`. No backend changes are required: it reads the existing `/transaction/last/{n}` feed (one call covers ~24h at current volume) and pages back by block-number range if volume ever outgrows the 1000-row cap.
- **Per tokenized asset** — GOLDST / SILVST / USDST: `price`, `circulatingSupply`, `marketCap`, `aum`, `nav`, `volume`. See `src/tokenMetrics.ts`.

Runs as a standalone container alongside the STRATO platform — it is **not** built into `strato-init` and does not require any platform changes to enable or disable. Operators opt in by bringing the service up with its own compose file.

## Required environment variables

| Var | Description |
| --- | --- |
| `RWA_IO_API_KEY` | API key issued by rwa.io. **Required.** |

Optional overrides for the STRATO endpoint and cron schedule live in `src/config.ts`. Token IDs and per-metric time-series IDs are also configured there.

## Running standalone

```sh
cd mercata/services/rwa-io
export RWA_IO_API_KEY=...
docker compose -f docker-compose.rwa-io.yml up -d --build
```

## Local development

```sh
cd mercata/services/rwa-io
npm install
cp .env.example .env  # then fill in RWA_IO_API_KEY
npm run dev           # ts-node, full schedule
npm run dry-run       # one-shot, no real POSTs to rwa.io
```

## Health check

The container marks itself healthy by touching `/tmp/rwa-io-healthy` after the first successful push cycle. Docker's `HEALTHCHECK` reads that file every 60s.
