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
| `GET /t/:slug` | none | Resolve a link: record `link_opened`, set the `strato_tid` session cookie (90 days, HttpOnly, SameSite=Lax), 302 to the stored destination — a relative path lands **on the original host** (relative Location — visitors on any node edge that proxies `/t/` land back on that node), an absolute http(s) URL goes where it points (a **cross-host** destination also carries `?stid=<session id>`) |
| `POST /tracking-api/engage` | session id | SPA boot ping; sets `engaged_at` so JS-less bots/email scanners never count as engagement |
| `POST /tracking-api/wallet-connected` | session id or PostHog session id | Records external wallet and/or STRATO address for tracking-link attribution and the privacy-safe PostHog-to-wallet join (deduped) |
| `GET /dashboard` | OIDC (SPA login) | The dashboard app (tracking-ui container) |
| `GET /tracking-api/me` | JWT | `{authorized}` — whether the user may use the dashboard |
| `GET /tracking-api/links` | JWT + allowlist | Link summaries with attribution rollups |
| `GET /tracking-api/metrics/daily` | JWT + allowlist | Daily snapshot: today's (UTC) opens/engaged, wallets/bridged, bridged-in USD + transfers, on-chain actions — each against the same elapsed window yesterday — plus a 24-bucket opens-by-hour histogram and the busiest links |
| `POST /tracking-api/links` | JWT + allowlist | Create a link (random slug; label/source never appear in the URL) |
| `GET /tracking-api/links/:id` | JWT + allowlist | Bridge-ins, per-category activity summary, per-wallet summaries, visitor geo points with per-visit timestamps and wallet identity, attributed activity feed, per-day history (opens, wallets, bridge/trade value, …) |
| `GET /tracking-api/links/:id/wallets/:address` | JWT + allowlist | Per-user drill-down: the wallet's full on-chain history (deliberately not attribution-filtered) |
| `GET /tracking-api/users/:address/timeline` | JWT + allowlist | One wallet's activity timeline across every link: opens, engagement, wallet connections, bridge-ins, on-chain events and (optionally) origin-chain transactions |
| `PATCH /tracking-api/links/:id` | JWT + allowlist | Toggle active / edit label, source, full source, destination |

The dashboard app (`ui/`) logs in with OAuth code+PKCE against the Keycloak
realm (public client, default id `tracking-dashboard` — must be registered in
Keycloak with `https://<TRACKING_HOST>/dashboard/callback` as a redirect URI)
and sends `Authorization: Bearer` to `/tracking-api/*`; the service verifies
JWT signatures via JWKS. Outbound connections from this stack: Keycloak
(JWKS + login) and `NODE_URL` (anonymous Cirrus reads).

Dashboard access = Keycloak `preferred_username` in `TRACKING_AUTHORIZED_USERS`
(allowlist only — there is no on-chain-admin fallback, so admins who need the
dashboard must be listed too).

## Session identification

Everything downstream of an open (engagement, wallet connections, and
therefore every bridge/activity metric) hangs off the session id, so the
beacons accept it from three carriers, in order:

1. the `strato_tid` cookie (primary),
2. the `X-Strato-Tid` header,
3. the `stid` query parameter (or `stid` in the JSON body).

A cookie set by the tracking host is invisible to a destination on another
host, so the resolver appends `?stid=<session id>` whenever it redirects to a
different host than the one the visitor requested. As a last resort a
`wallet-connected` beacon that arrives with no session id at all is bound to
the newest non-bot open from the **same public IP** within
`TRACKING_IP_FALLBACK_MINUTES` (default 30, `0` disables); the fallback is
skipped for private IPs and whenever that window holds opens of more than one
link, so it can only confirm an unambiguous visitor. `wallet_connections.session_source`
records which carrier was used (`cookie`/`header`/`query`/`ip`).

Direct product sessions do not need a tracking-link id to enter the product
conversion funnel. The SPA sends PostHog's anonymous session/distinct ids to
this first-party endpoint alongside the wallet address, while PostHog receives
only a `wallet_connected` event with connector and address-presence booleans.
Wallet addresses never enter PostHog. This creates a controlled join for later
chain-conversion analysis without weakening the existing link-attribution
rules.

## Bot and preview filtering

Only opens classified as human count towards `opens` (and only they get a
cookie). Named crawlers, email scanners and link-preview fetchers
(`facebookexternalhit`, `Googlebot`, `curl`, …), `HEAD` requests, prefetches
and UA-less requests are filtered outright. Generic tokens that a real client
can also carry (`bot` in a device name, `preview`, `scan`, `whatsapp`,
`telegram`, …) only filter a visit when nothing else in the UA looks like a
rendering browser — mobile in-app browsers (WhatsApp/Facebook/Instagram/
Telegram/X webviews) run our JS and connect wallets, so they must never be
filtered. `tracking_sessions.bot_reason` records why a visit was filtered (or
which ambiguous token a real browser overrode), and the link's Summary card
shows engaged and bot-filtered opens next to the raw count.

## Attribution

For each chain event: the most recent non-bot tracked wallet connection
before the event, within `TRACKING_ATTRIBUTION_WINDOW_DAYS` (default 90),
wins; ties break to the earliest-created connection. Block timestamps and this
server's clock are independent, so a connection recorded up to
`TRACKING_ATTRIBUTION_GRACE_MINUTES` (default 30) *after* the event still
claims it. Addresses are compared normalized (lowercase, no `0x`) on both
sides, and Cirrus filters carry both spellings.
Assignment is computed once over all links' connections, so one chain event is
never counted under two links. Bridge completion events carry both
`externalSender` and `stratoRecipient`, so either identifier attributes the
wallet. Link-level metrics count attributed events only; the per-wallet
drill-down shows full history.

## Daily snapshot

The dashboard's top panel is one aggregation endpoint (`/tracking-api/metrics/daily`)
over the **UTC day**, matching the per-day history buckets. Session figures
(opens, engaged, hour buckets, busiest links, "N of M links active") are SQL
rollups over `tracking_sessions`; wallet and chain figures reuse the cached
attribution snapshot, so nothing is counted twice and the attribution rules
are identical to the links table. Each headline metric carries the value from
the **same elapsed window yesterday** (yesterday 00:00 UTC → yesterday at
today's time of day) so a half-finished day isn't compared against a whole
one; with no baseline the change is reported as `null` ("new"). Today's chain
window runs to the end of the UTC day because block timestamps can sit
slightly ahead of the service's clock. Bridged-in USD counts priced tokens
only and sets `bridgeValuePartial` when some token had no oracle price (the
dashboard renders "$128.4K+").

## Links table

`GET /tracking-api/links` returns every link (lifetime totals, newest first) in
one unpaginated array; the "All links" table filters and sorts it in the
browser. The search box matches slug, URL, label, source, full source and
creator; each data column header cycles ascending → descending → back to the
server order, with blanks and missing values always sorted last.

## Storage

Owns the `tracking` Postgres database: `tracking_links`, `tracking_sessions`,
`wallet_connections`, and `posthog_wallet_connections`. The last table keeps
the first-party PostHog-session-to-wallet join separate from tracking-link
attribution. Migrations are embedded in `src/db/migrations.ts` and run
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
| `POSTGRES_HOST/PORT/USER/PASSWORD` | `postgres/5432/postgres` | DB connection (compose maps to `postgres_*`); point at RDS for remote mode |
| `POSTGRES_SSL` | empty (plaintext) | `require` (TLS, no verify) or `verify-full` (+ `POSTGRES_SSL_CA` bundle path) |
| `TRACKING_DB_CREATE` | `true` | Set `false` when the DB user can't create databases (pre-created RDS DB) |
| `TRACKING_DB_NAME` | `tracking` | Service-owned database |
| `TRACKING_AUTHORIZED_USERS` | empty | Comma-separated Keycloak usernames (sales/marketing) |
| `TRACKING_DEFAULT_DESTINATION` | `/dashboard/deposits` | Bridge In page |
| `TRACKING_COOKIE_DOMAIN` | empty (host-only) | Set `.strato.nexus` in prod so a future `go.strato.nexus` CNAME shares the cookie |
| `TRACKING_IPINFO_TOKEN` | empty (offline fallback) | ipinfo.io token for live IP geolocation |
| `TRACKING_ATTRIBUTION_WINDOW_DAYS` | `90` | Attribution window |
| `TRACKING_ATTRIBUTION_GRACE_MINUTES` | `30` | Grace period for a chain event whose block timestamp sits marginally before the wallet connection |
| `TRACKING_IP_FALLBACK_MINUTES` | `30` | Window in which a cookieless `wallet-connected` beacon may bind to a recent open from the same public IP (`0` disables) |
| `TRACKING_CACHE_TTL_SECONDS` | `60` | Dashboard attribution cache |
| `TRACKING_ETHERSCAN_API_KEY` | empty (disabled) | Etherscan V2 key enabling origin-chain items in the user timeline |
| `TRACKING_ETHERSCAN_API_URL` | `https://api.etherscan.io/v2/api` | Etherscan-compatible endpoint (multichain via `chainid`) |
| `TRACKING_ETHERSCAN_MAX_TX` | `10` | Origin-chain transactions fetched per chain + wallet |
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

## User timeline

Clicking any wallet address in the dashboard opens
`/dashboard/users/<address>` — one chronological story per person, served by
`GET /tracking-api/users/:address/timeline`:

- **Off-chain** (this service's tables): tracking-link opens (with visitor
  location and referrer), the SPA engagement ping, and wallet connections —
  across *every* link the wallet touched, not just one.
- **On-chain** (the same Cirrus snapshot the link views use): bridge-ins with
  their STRATO and origin-chain transaction links, plus swaps, CDP, savings,
  transfers, bridge-outs … Each chain item also reports which link it is
  attributed to, if any; the timeline itself is deliberately not
  attribution-filtered (a prospect's pre-link history is sales signal).
- **Origin chain** (optional): with `TRACKING_ETHERSCAN_API_KEY` set, the
  external sender's most recent transactions on the chain it bridged from
  (Etherscan V2 is multichain, so one key covers Ethereum/Base/Polygon/…),
  which shows how the wallet was funded before it arrived. Results are cached
  in-process for 5 minutes per chain + address to stay inside the free rate
  limit; without a key the timeline simply omits these items and the dashboard
  says so.

The external wallet and the STRATO account are followed through the
connection rows that carry both, so either address renders the same timeline.
Read-only: no new tables or columns.

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
are stored; the map excludes them.

The map is interactive: scroll or drag to zoom and pan (plus explicit zoom
in/out/reset buttons), a dual-handle time-range slider narrows the visible
opens, and clicking a dot opens that visitor's timeline
(`/dashboard/users/<address>`) — or, when several visitors share a dot, a
popover listing them. To make that possible each geo point carries its
individual visits (`{at, address}`, newest first) instead of a bare count;
`address` is the session's wallet identity (external address first, STRATO
otherwise) and is `null` for a visit that never connected a wallet. No IP is
part of the payload. Only the 5,000 most recent geolocated sessions per link
are returned; beyond that the response sets `geoTruncated: true` and the map
says it is showing the most recent opens. A visitor spoofing `X-Forwarded-For` on a
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
