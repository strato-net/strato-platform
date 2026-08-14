# STRATO Tracking Service

Referral/tracking-link service for STRATO: sales and marketing create short
links (`/t/<slug>`), the service records opens, wallet connections, and
visitor geo offchain, and joins them against on-chain activity from Cirrus
(bridge-ins, swaps, CDP, savings, transfers, ...). The dashboard is served by
this stack itself at `https://<TRACKING_HOST>/dashboard` (the `ui/` app in
this directory). Chain data is never copied offchain; Cirrus remains the
source of truth.

## Endpoints

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /t/:slug` | none | Resolve a link: record `link_opened`, set the `strato_tid` session cookie (90 days, HttpOnly, SameSite=Lax), 302 to the allowlisted destination **on the original host** (relative Location — visitors on any node edge that proxies `/t/` land back on that node) |
| `POST /tracking-api/engage` | cookie | SPA boot ping; sets `engaged_at` so JS-less bots/email scanners never count as engagement |
| `POST /tracking-api/wallet-connected` | cookie | Records external wallet and/or STRATO address for the session (deduped) |
| `GET /tracking-api/attribution-touches?from=<ISO>&to=<ISO>` | `X-Tracking-API-Key` | Read-only wallet/campaign attribution touchpoints whose attribution windows overlap the requested reporting period |
| `GET /dashboard` | OIDC (SPA login) | The dashboard app (tracking-ui container) |
| `GET /tracking-api/me` | JWT | `{authorized}` — whether the user may use the dashboard |
| `GET /tracking-api/links` | JWT + allowlist | Link summaries with attribution rollups |
| `POST /tracking-api/links` | JWT + allowlist | Create a link (random slug; label/source never appear in the URL) |
| `GET /tracking-api/links/:id` | JWT + allowlist | Bridge-ins, per-category activity summary, per-wallet summaries, visitor geo points, attributed activity feed |
| `GET /tracking-api/links/:id/wallets/:address` | JWT + allowlist | Per-user drill-down: the wallet's full on-chain history (deliberately not attribution-filtered) |
| `PATCH /tracking-api/links/:id` | JWT + allowlist | Toggle active / edit label+source |

The dashboard app (`ui/`) logs in with OAuth code+PKCE against the Keycloak
realm (public client, default id `tracking-dashboard` — must be registered in
Keycloak with `https://<TRACKING_HOST>/dashboard/callback` as a redirect URI)
and sends `Authorization: Bearer` to `/tracking-api/*`; the service verifies
JWT signatures via JWKS. Outbound connections from this stack: Keycloak
(JWKS + login) and `NODE_URL` (anonymous Cirrus reads).

Dashboard access = Keycloak `preferred_username` in `TRACKING_AUTHORIZED_USERS`
(allowlist only — there is no on-chain-admin fallback, so admins who need the
dashboard must be listed too).

## Attribution

For each chain event: the most recent non-bot tracked wallet connection
before the event, within `TRACKING_ATTRIBUTION_WINDOW_DAYS` (default 90),
wins; ties break to the earliest-created connection.
Assignment is computed once over all links' connections, so one chain event is
never counted under two links. Bridge completion events carry both
`externalSender` and `stratoRecipient`, so either identifier attributes the
wallet. Link-level metrics count attributed events only; the per-wallet
drill-down shows full history.

The reporting endpoint exposes the same eligible, non-bot wallet connections
without copying chain events into this database. Each row includes the external
and STRATO wallet addresses, campaign, connection time, and attribution expiry.
The reporting consumer assigns an event to the most recent connection before
the event; if connection times tie, the lowest connection ID wins. `from` is
inclusive and `to` is exclusive. The endpoint requires the
`TRACKING_REPORT_API_TOKEN` service credential and never accepts that token in
the URL.

## Storage

Owns the `tracking` Postgres database: `tracking_links`, `tracking_sessions`,
`wallet_connections`. Migrations are embedded in `src/db/migrations.ts` and run
idempotently at startup under an advisory lock. Two database modes:

- **Local container** (default for dev): start the stack with the `local-db`
  compose profile — `COMPOSE_PROFILES=local-db docker compose -f
  docker-compose.tracking.yml up -d`. The service creates the `tracking` DB on
  first boot.
- **Remote Postgres / AWS RDS**: omit the profile (no postgres container
  starts) and set `POSTGRES_HOST` to the RDS endpoint, `POSTGRES_USER`,
  `POSTGRES_PASSWORD`, and `POSTGRES_SSL=require` (RDS `force_ssl`) or
  `POSTGRES_SSL=verify-full` + `POSTGRES_SSL_CA=<path to the AWS RDS CA
  bundle mounted into the container>`. If the DB user can create databases,
  boot handles everything (set `POSTGRES_MAINTENANCE_DB` if the maintenance DB
  isn't `postgres`); otherwise pre-create the `tracking` database and set
  `TRACKING_DB_CREATE=false` to skip the create step entirely. The service
  retries the DB connection for ~60s at startup, so ordering doesn't matter.

## Deployment

The service runs as a **standalone compose stack on its own server** (same
model as the bridge service at bridge.strato.nexus): tracking + its own
Postgres + its own nginx (`nginx/` in this directory, TLS termination). The
stack file is generated from `docker-compose.tracking.tpl.yml` at the repo
root by `make docker-compose`.

```sh
# Build images (repo root; files must be git-tracked for the tag hash)
make tracking tracking-nginx tracking-ui docker-compose

# On the tracking server: docker-compose.tracking.yml + ./ssl certs + env
NODE_URL=https://app.strato.nexus \
OPENID_DISCOVERY_URL=https://keycloak.blockapps.net/auth/realms/mercata/.well-known/openid-configuration \
POSTGRES_PASSWORD=... \
TRACKING_COOKIE_DOMAIN=.strato.nexus \
TRACKING_AUTHORIZED_USERS=... \
docker compose -f docker-compose.tracking.yml up -d
```

Point the short-link domain (e.g. `go.strato.nexus`) at this server. The
dashboard lives at `https://<TRACKING_HOST>/dashboard`. On the **app node's**
edge nginx, enable the proxy locations so the STRATO SPA's beacons stay
same-origin:

```
TRACKING_ENABLED=true
TRACKING_URL=https://go.strato.nexus
```

Traffic split: `go.strato.nexus/t/<slug>` and `/dashboard` hit this stack
directly; `app.strato.nexus/t/...` plus the two beacon endpoints go through
the app edge, which forwards the client IP and proxies here.

## Configuration

| Env | Default | Purpose |
|---|---|---|
| `PORT` | `3010` | Listen port |
| `NODE_URL` | required for chain metrics | STRATO node edge for anonymous Cirrus reads, e.g. `https://app.strato.nexus` |
| `OPENID_DISCOVERY_URL` | from `/run/secrets/oauth_credentials.yaml` | JWKS for dashboard JWT verification |
| `TRACKING_REPORT_API_TOKEN` | empty | Long random service credential for the read-only attribution reporting endpoint |
| `POSTGRES_HOST/PORT/USER/PASSWORD` | `postgres/5432/postgres` | DB connection (compose maps to `postgres_*`); point at RDS for remote mode |
| `POSTGRES_SSL` | empty (plaintext) | `require` (TLS, no verify) or `verify-full` (+ `POSTGRES_SSL_CA` bundle path) |
| `TRACKING_DB_CREATE` | `true` | Set `false` when the DB user can't create databases (pre-created RDS DB) |
| `TRACKING_DB_NAME` | `tracking` | Service-owned database |
| `TRACKING_AUTHORIZED_USERS` | empty | Comma-separated Keycloak usernames (sales/marketing) |
| `TRACKING_DEST_ALLOWLIST` | `/dashboard/deposits,/dashboard,/dashboard/swap,/dashboard/earn,/dashboard/rewards` | Allowed link destinations |
| `TRACKING_DEFAULT_DESTINATION` | `/dashboard/deposits` | Bridge In page |
| `TRACKING_COOKIE_DOMAIN` | empty (host-only) | Set `.strato.nexus` in prod so a future `go.strato.nexus` CNAME shares the cookie |
| `TRACKING_IPINFO_TOKEN` | empty (offline fallback) | ipinfo.io token for live IP geolocation |
| `TRACKING_ATTRIBUTION_WINDOW_DAYS` | `90` | Attribution window |
| `TRACKING_CACHE_TTL_SECONDS` | `60` | Dashboard attribution cache |
| `ssl` | `false` | Adds `Secure` to the session cookie |

tracking-ui container env (runtime `config.js`): `OIDC_AUTHORITY` (default
`https://keycloak.blockapps.net/auth/realms/mercata`), `OIDC_CLIENT_ID`
(default `tracking-dashboard`), `EXPLORER_URL` (default
`https://stratoscan.strato.nexus`), `TRACKING_APP_ORIGIN` (default
`https://app.strato.nexus`) — display-only origin the dashboard uses to render
and copy full link URLs; redirects remain host-relative and nginx never
consults it.

## Activity categories

Cirrus events are grouped into dashboard categories (bridge in/out, swaps,
liquidity add/remove, CDP borrow/repay via `USDSTMinted`/`USDSTBurned`,
savings vault deposit/withdraw, transfers sent/received, metal purchases,
vault deposits/withdrawals, lending, staking, rewards) — the mapping lives in
`src/services/cirrusService.ts` and mirrors the marketplace backend's
`activityFilterConfigs.ts`. Link-level summaries count only events attributed
to the link (90-day most-recent-connection rule); the per-wallet drill-down
shows the wallet's full history. Transfer counts include protocol-driven
transfers (swap legs, vault moves), not just P2P sends.

## IP geolocation

The resolver records the visitor's IP (via `X-Forwarded-For`, forwarded by
both nginx layers). Location resolution has two tiers:

1. **Live lookup (recommended)** — set `TRACKING_IPINFO_TOKEN` (free ipinfo.io
   account, 50k lookups/month). Runs asynchronously after the 302 and updates
   the session row; a small in-memory cache keeps repeat opens from the same
   IP off the quota. Always-current data — this is the fix for stale results
   (e.g. VPN ranges resolving to their previous owner's country).
2. **Offline fallback** — geoip-lite's bundled GeoLite2 snapshot (no egress,
   ~130MB in the image). The snapshot is frozen at package publish time and
   goes stale, especially for reassigned/VPN ranges; refresh it at image build
   with `--build-arg MAXMIND_LICENSE_KEY=...` (free MaxMind account). Used for
   the immediate insert and whenever the live lookup is unconfigured or fails.

Coordinates power the dashboard's visitor map; raw IPs stay in the DB and are
not returned by the API. Bots never set the session cookie but their sessions
are stored; the map excludes them. A visitor spoofing `X-Forwarded-For` on a
direct hit to the tracking domain can fake their own dot — acceptable for
marketing analytics. Sessions recorded before the live lookup was enabled keep
their original (possibly stale) geo.

## Known V1 limitations

- `wallet-connected` is unauthenticated by design (anonymous visitors), so a
  malicious visitor could attribute an arbitrary address to their own session;
  acceptable for marketing analytics. V2 fix: signed-message proof.
- Bridge value converts token amounts via the on-chain PriceOracle; unpriced
  tokens make a link's total show as unknown rather than a wrong number.
- Activity from the unified Cirrus `event` table has no transaction hash
  (the table lacks the column), so those rows have no explorer link.
