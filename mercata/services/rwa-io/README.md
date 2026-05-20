# RWA.io Adapter

Sidecar service that periodically pushes STRATO financial metrics (TVL, token price, circulating supply, market cap, AUM, NAV, 24h volume) to the [RWA.io](https://rwa.io) project time-series API.

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
