# Mercata Tracking Service

Referral/tracking-link service for STRATO: sales and marketing create short
links (`/t/<slug>`), the service records opens and wallet connections offchain,
and the dashboard API joins those connections against on-chain activity from
Cirrus (bridge-ins, swaps, metal purchases, vault deposits, lending, staking).
Chain data is never copied offchain; Cirrus remains the source of truth.

## Endpoints

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /t/:slug` | none | Resolve a link: record `link_opened`, set the `strato_tid` session cookie (90 days, HttpOnly, SameSite=Lax), 302 to the allowlisted destination |
| `POST /tracking-api/engage` | cookie | SPA boot ping; sets `engaged_at` so JS-less bots/email scanners never count as engagement |
| `POST /tracking-api/wallet-connected` | cookie | Records external wallet and/or STRATO address for the session (deduped) |
| `GET /tracking-api/me` | OIDC | `{authorized}` — whether the user may use the dashboard |
| `GET /tracking-api/links` | OIDC + allowlist | Link summaries with attribution rollups |
| `POST /tracking-api/links` | OIDC + allowlist | Create a link (random slug; label/source never appear in the URL) |
| `GET /tracking-api/links/:id` | OIDC + allowlist | Connections, bridge-ins, and activity attributed to the link |
| `PATCH /tracking-api/links/:id` | OIDC + allowlist | Toggle active / edit label+source |

Dashboard access = Keycloak `preferred_username` in `TRACKING_AUTHORIZED_USERS`
OR on-chain admin (AdminRegistry), mirroring the marketplace backend.

## Attribution

For each chain event: the most recent non-bot tracked wallet connection before
the event, within `TRACKING_ATTRIBUTION_WINDOW_DAYS` (default 90), wins; ties
break to the earliest-created connection. Assignment is computed once over all
links' connections, so one chain event is never counted under two links.
Bridge completion events carry both `externalSender` and `stratoRecipient`, so
either identifier attributes the wallet.

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
NODE_URL=https://app.strato.nexus \
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
| `NODE_URL` | required (docker-run.sh exports `http://nginx:8081`) | Edge origin for anonymous Cirrus reads and `/strato/v2.3/key` |
| `OPENID_DISCOVERY_URL` | from `/run/secrets/oauth_credentials.yaml` | JWKS for dashboard JWT verification |
| `postgres_host/port/user/password` | `postgres/5432/postgres` + secret | Writable pool |
| `TRACKING_DB_NAME` | `tracking` | Service-owned database |
| `TRACKING_AUTHORIZED_USERS` | empty | Comma-separated Keycloak usernames (sales/marketing) |
| `TRACKING_DEST_ALLOWLIST` | `/dashboard/deposits,/dashboard,/dashboard/swap,/dashboard/earn,/dashboard/rewards` | Allowed link destinations |
| `TRACKING_DEFAULT_DESTINATION` | `/dashboard/deposits` | Bridge In page |
| `TRACKING_COOKIE_DOMAIN` | empty (host-only) | Set `.strato.nexus` in prod so a future `go.strato.nexus` CNAME shares the cookie |
| `TRACKING_APP_ORIGIN` | empty (relative redirects) | e.g. `https://app.strato.nexus`; also used in generated link URLs |
| `TRACKING_ATTRIBUTION_WINDOW_DAYS` | `90` | Attribution window |
| `TRACKING_CACHE_TTL_SECONDS` | `60` | Dashboard attribution cache |
| `ssl` | `false` | Adds `Secure` to the session cookie |

## Known V1 limitations

- `wallet-connected` is unauthenticated by design (anonymous visitors), so a
  malicious visitor could attribute an arbitrary address to their own session;
  acceptable for marketing analytics. V2 fix: signed-message proof.
- Bridge value converts token amounts via the on-chain PriceOracle; unpriced
  tokens make a link's total show as unknown rather than a wrong number.
- Activity from the unified Cirrus `event` table has no transaction hash
  (the table lacks the column), so those rows have no explorer link.
