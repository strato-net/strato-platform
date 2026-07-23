# Mercata Tracking Service

Referral/tracking-link service for STRATO: sales and marketing create short
links (`/t/<slug>`), and the service records opens, wallet connections, and
visitor geo offchain. The dashboard UI joins that data against on-chain
activity fetched from the mercata backend's Cirrus (bridge-ins, swaps, metal
purchases, vault deposits, lending, staking). Chain data is never copied
offchain; Cirrus remains the source of truth.

## Endpoints

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /t/:slug` | none | Resolve a link: record `link_opened`, set the `strato_tid` session cookie (90 days, HttpOnly, SameSite=Lax), 302 to the allowlisted destination |
| `POST /tracking-api/engage` | cookie | SPA boot ping; sets `engaged_at` so JS-less bots/email scanners never count as engagement |
| `POST /tracking-api/wallet-connected` | cookie | Records external wallet and/or STRATO address for the session (deduped) |
| `GET /tracking-api/me` | OIDC | `{authorized}` — whether the user may use the dashboard |
| `GET /tracking-api/snapshot` | OIDC + allowlist | The full offchain dataset: links, wallet connections, session stats, geo points |
| `POST /tracking-api/links` | OIDC + allowlist | Create a link (random slug; label/source never appear in the URL) |
| `PATCH /tracking-api/links/:id` | OIDC + allowlist | Toggle active / edit label+source |

This service holds **offchain data only** and never talks to STRATO nodes or
Cirrus — its sole outbound dependency is Keycloak's JWKS for dashboard JWT
verification. Chain activity is served separately by the mercata backend
(`POST /api/tracking/activity`, addresses in → categorized Cirrus events +
bridge-ins out), and the UI joins the two datasets with the attribution
engine in `mercata/ui/src/lib/trackingEngine.ts`.

Dashboard access = Keycloak `preferred_username` in `TRACKING_AUTHORIZED_USERS`
(allowlist only — the on-chain-admin fallback was dropped along with node
access, so admins who need the dashboard must be listed too).

## Attribution

Runs client-side in `mercata/ui/src/lib/trackingEngine.ts`: for each chain
event, the most recent non-bot tracked wallet connection before the event,
within the 90-day window, wins; ties break to the earliest-created connection.
Assignment is computed once over all links' connections, so one chain event is
never counted under two links. Bridge completion events carry both
`externalSender` and `stratoRecipient`, so either identifier attributes the
wallet. Link-level metrics count attributed events only; the per-wallet
drill-down shows full history.

## Storage

Owns the `tracking` Postgres database (created at boot) on the shared platform
`postgres` container: `tracking_links`, `tracking_sessions`,
`wallet_connections`. Migrations are embedded in `src/db/migrations.ts` and run
idempotently at startup under an advisory lock.

## Deployment

The service runs as a **standalone compose stack on its own server** (same
model as the bridge service at bridge.strato.nexus): tracking + its own
Postgres + its own nginx (`nginx/` in this directory, TLS termination). The
stack file is generated from `docker-compose.tracking.tpl.yml` at the repo
root by `make docker-compose`.

```sh
# Build images (repo root; files must be git-tracked for the tag hash)
make tracking tracking-nginx docker-compose

# On the tracking server: docker-compose.tracking.yml + ./ssl certs + env
OPENID_DISCOVERY_URL=https://keycloak.blockapps.net/auth/realms/mercata/.well-known/openid-configuration \
POSTGRES_PASSWORD=... \
TRACKING_APP_ORIGIN=https://app.strato.nexus \
TRACKING_COOKIE_DOMAIN=.strato.nexus \
TRACKING_AUTHORIZED_USERS=... \
docker compose -f docker-compose.tracking.yml up -d
```

Point the short-link domain (e.g. `go.strato.nexus`) at this server. On the
**app node's** edge nginx, enable the proxy locations so the SPA's beacons and
dashboard calls stay same-origin (and OIDC token injection keeps working):

```
TRACKING_ENABLED=true
TRACKING_URL=https://go.strato.nexus
```

Traffic split: `go.strato.nexus/t/<slug>` hits this stack directly (public
resolver, sets the session cookie with `Domain=.strato.nexus`);
`app.strato.nexus/tracking-api/*` goes through the app edge, which validates
the OIDC session and injects `X-USER-ACCESS-TOKEN` before proxying here. The
service verifies the JWT signature itself, so direct callers can't forge it.

## Configuration

| Env | Default | Purpose |
|---|---|---|
| `PORT` | `3010` | Listen port |
| `OPENID_DISCOVERY_URL` | from `/run/secrets/oauth_credentials.yaml` | JWKS for dashboard JWT verification |
| `postgres_host/port/user/password` | `postgres/5432/postgres` + secret | Writable pool |
| `TRACKING_DB_NAME` | `tracking` | Service-owned database |
| `TRACKING_AUTHORIZED_USERS` | empty | Comma-separated Keycloak usernames (sales/marketing) |
| `TRACKING_DEST_ALLOWLIST` | `/dashboard/deposits,/dashboard,/dashboard/swap,/dashboard/earn,/dashboard/rewards` | Allowed link destinations |
| `TRACKING_DEFAULT_DESTINATION` | `/dashboard/deposits` | Bridge In page |
| `TRACKING_COOKIE_DOMAIN` | empty (host-only) | Set `.strato.nexus` in prod so a future `go.strato.nexus` CNAME shares the cookie |
| `TRACKING_APP_ORIGIN` | empty (relative redirects) | e.g. `https://app.strato.nexus`; also used in generated link URLs |
| `ssl` | `false` | Adds `Secure` to the session cookie |

## Activity categories

Cirrus events are grouped into dashboard categories (bridge in/out, swaps,
liquidity add/remove, CDP borrow/repay via `USDSTMinted`/`USDSTBurned`,
savings vault deposit/withdraw, transfers sent/received, metal purchases,
vault deposits/withdrawals, lending, staking, rewards) — the mapping lives in
the mercata backend (`src/api/services/tracking.service.ts`) and mirrors its
`activityFilterConfigs.ts`. Link-level summaries count only events attributed
to the link (90-day most-recent-connection rule); the per-wallet drill-down
shows the wallet's full history. Transfer counts include protocol-driven
transfers (swap legs, vault moves), not just P2P sends.

## IP geolocation

The resolver records the visitor's IP (via `X-Forwarded-For`, forwarded by
both nginx layers) and resolves it offline with geoip-lite (bundled MaxMind
GeoLite2 city data — no network egress, adds ~130MB to the image; refresh the
dataset by updating the geoip-lite package). Coordinates power the dashboard's
visitor map; raw IPs stay in the DB and are not returned by the API. Bots
never set the session cookie but their sessions are stored; the map excludes
them. A visitor spoofing `X-Forwarded-For` on a direct hit to the tracking
domain can fake their own dot — acceptable for marketing analytics.

## Known V1 limitations

- `wallet-connected` is unauthenticated by design (anonymous visitors), so a
  malicious visitor could attribute an arbitrary address to their own session;
  acceptable for marketing analytics. V2 fix: signed-message proof.
- Bridge value converts token amounts via the on-chain PriceOracle; unpriced
  tokens make a link's total show as unknown rather than a wrong number.
- Activity from the unified Cirrus `event` table has no transaction hash
  (the table lacks the column), so those rows have no explorer link.
