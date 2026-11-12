# Partner referrals service

Server-to-server referral integration for partner platforms (CreatorWire
campaigns). A partner asks for a user's referral code when the user joins a
campaign, the user shares the link, and the partner reads referrals, traders
and USD volume per code for a date range.

## API

All under `/partner-api`. Partner calls carry `Authorization: Bearer <key>`;
each key reads only the codes issued through it. Keys are 32 or more random
characters (`openssl rand -hex 32`); the service does not start with a
shorter one. Paths are exact: case-sensitive, no trailing slash. JSON,
timestamps in ISO 8601 UTC, USD amounts as decimal strings. Errors are
`{"error": {"code": "...", "message": "..."}}` with `400 BAD_REQUEST` or
`401 UNAUTHORIZED`.

- `POST /referrals/codes` `{external_user_id, x_user_id?, email?, wallet?}`
  returns `{code, ref_link?, created}`. One code per `external_user_id`, used
  for every campaign; calling again returns the same code with
  `created: false`. The owner is the partner's user and needs no STRATO
  account, so `404 OWNER_NOT_FOUND` is never returned.
- `GET /referrals/metrics?from=&to=&limit=&cursor=` returns
  `{data_as_of, codes: [{code, external_user_id, referrals, traders, volume_usd}], next_cursor}`
  for every code of the calling key. `from` is inclusive, `to` exclusive;
  `limit` is 1 to 1000 (default 100).
- `POST /referrals/signups` `{code, account, email?}`: internal, called by
  the app backend with `PARTNER_INTERNAL_KEY`. The app nginx answers 404 for
  it. Where the service has a load balancer of its own, the path is
  reachable there and the key is what guards it.
- `GET /health`

| Field | Meaning |
|---|---|
| `referrals` | Accounts that signed up with the code inside the window |
| `traders` | Unique accounts referred by the code at any time, with counted activity inside the window |
| `volume_usd` | USD value of that activity at the oracle price when it happened, each event counted once |

The window applies to the signup for `referrals` and to the activity for
`traders` and `volume_usd`. A code whose referrals all signed up before the
window therefore reports `referrals: 0` next to their `traders` and
`volume_usd` inside it.

## How a referral is recorded

The ref link is the app's URL with `?ref=<code>`. The UI keeps the code in a
`ref` cookie (first touch wins); when the backend's `/user/me` creates the
account, it forwards the code here with the account's email (the login
token's `email` claim, or the username where the realm issues none). An
account is referred once, by the first code, and an owner's own account
(matched on the wallet or email they shared) is left out.

The backend's call is not part of the signup. While this service cannot be
reached it is tried again, for up to a day, from the backend's memory (a
backend restart ends the retries). The first failure and a final one are
logged with the code and account (`Partner referral not recorded`), which is
what it takes to replay the signup against `/referrals/signups`.

Only accounts the backend creates at a first login are recorded. A guest who
connects an external wallet without logging in has no signup and is not
attributed.

## What counts as volume

A Cirrus poller pages the node's global `event` table by id. Event names
collide across contracts, so every event is taken from a trusted contract
only:

| Event | From | Account | Valued by |
|---|---|---|---|
| `Swap` (Pool, StablePool, PoolV3) | pools created by `PARTNER_POOL_FACTORIES` | transaction sender | input token |
| `MetalMinted` | `METAL_FORGE` | `buyer` | `payToken` |
| `DepositCompleted` (bridge in) | `MERCATA_BRIDGE` | `stratoRecipient` | `stratoToken` |
| `Deposited`, `SuppliedCollateral` | `LENDING_POOL` | `user` | `asset` |
| `Deposited` | `CDP_ENGINE` | `owner` | `asset` |

Prices come from `PriceUpdated` / `BatchPricesUpdated` of `PRICE_ORACLE`;
rows arrive in chain order, so an event is valued at the price in force when
it executed. Amounts are in the token's own decimals, read from the token's
Cirrus record (`customDecimals`). Events on unpriced tokens, and on priced
assets that have no token record, are not counted.

Activity is kept for good for referred accounts, and for seven days for
everyone else, so a signup that is recorded late (a retry, a replay) still
counts the account's first events.

Volume is gross and unscreened: a deposit that is withdrawn and deposited
again counts twice, and wash trading between referred accounts is not
detected.

## Configuration

| Variable | Default | |
|---|---|---|
| `PARTNER_API_KEYS` | | `partner:key,partner:key`, each key 32+ characters; a staging and a production key are two entries. Also read from `/run/secrets/partner_api_keys` |
| `PARTNER_INTERNAL_KEY` | | Shared with the app backend; 32+ characters and not a partner key. Also read from `/run/secrets/partner_internal_key` |
| `PARTNER_REF_LINK_BASE` | | The app's public URL, e.g. `https://app.example/`. Unset, no `ref_link` is returned |
| `NODE_URL` | | The node whose Cirrus is indexed. Unset, nothing is indexed |
| `PARTNER_POOL_FACTORIES` | `…100a` | PoolFactory and the network's PoolV3Factory, comma separated |
| `METAL_FORGE` | | Network specific; unset, metal purchases are not counted |
| `PRICE_ORACLE`, `LENDING_POOL`, `MERCATA_BRIDGE`, `CDP_ENGINE` | system addresses | |
| `PARTNER_REFERRALS_DB_NAME` | `partner_referrals` | Created on first start unless `PARTNER_REFERRALS_DB_CREATE=false` |
| `postgres_host`, `postgres_port`, `postgres_user`, `postgres_password` | | As in the history service |
| `postgres_ssl`, `postgres_ssl_ca` | | `require` encrypts without checking the server; `verify-full` checks it against the CA bundle at `postgres_ssl_ca`. For AWS RDS the image carries that bundle at `/app/rds-global-bundle.pem` |
| `PORT` | `3040` | |

The app backend needs `PARTNER_REFERRALS_URL` and `PARTNER_INTERNAL_KEY`; the
app nginx needs `PARTNER_REFERRALS_HOST` to serve `/partner-api/`.

One instance is enough. A second one polling at the same time (a deployment
replacing the first) is safe: a page is only committed from the position it
was read at, so the slower of the two is refused and starts over.

## Tests

`npm test`. The Postgres suite runs when `postgres_host` is set.
