# Partner referrals service

Server-to-server referral integration for partner platforms (CreatorWire
campaigns). A partner asks for a user's referral code when the user joins a
campaign, the user shares the link, and the partner reads referrals, traders
and USD volume per code for a date range.

## API

All under `/partner-api`. Partner calls carry `Authorization: Bearer <key>`;
each key reads only the codes issued through it. JSON, timestamps in ISO 8601
UTC, USD amounts as decimal strings. Errors are
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
- `POST /referrals/signups` `{code, account, username?}`: internal, called by
  the app backend with `PARTNER_INTERNAL_KEY`; not exposed through nginx.
- `GET /health`

| Field | Meaning |
|---|---|
| `referrals` | Accounts that signed up with the code inside the window |
| `traders` | Unique referred accounts with counted activity inside the window |
| `volume_usd` | USD value of that activity at the oracle price when it happened, each event counted once |

## How a referral is recorded

The ref link is the app's URL with `?ref=<code>`. The UI keeps the code in a
`ref` cookie (first touch wins); when the backend's `/user/me` creates the
account, it forwards the code here. An account is referred once, by the first
code, and an owner's own account (matched on the wallet or email they shared)
is left out.

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
it executed. Events on unpriced tokens are not counted. Only activity of
accounts already referred is stored. Wash trading between referred accounts
is not detected.

## Configuration

| Variable | Default | |
|---|---|---|
| `PARTNER_API_KEYS` | | `partner:key,partner:key`; a staging and a production key are two entries. Also read from `/run/secrets/partner_api_keys` |
| `PARTNER_INTERNAL_KEY` | | Shared with the app backend. Also read from `/run/secrets/partner_internal_key` |
| `PARTNER_REF_LINK_BASE` | | The app's public URL, e.g. `https://app.example/`. Unset, no `ref_link` is returned |
| `NODE_URL` | | The node whose Cirrus is indexed. Unset, nothing is indexed |
| `PARTNER_POOL_FACTORIES` | `…100a` | PoolFactory and the network's PoolV3Factory, comma separated |
| `METAL_FORGE` | | Network specific; unset, metal purchases are not counted |
| `PRICE_ORACLE`, `LENDING_POOL`, `MERCATA_BRIDGE`, `CDP_ENGINE` | system addresses | |
| `PARTNER_REFERRALS_DB_NAME` | `partner_referrals` | Created on first start unless `PARTNER_REFERRALS_DB_CREATE=false` |
| `postgres_host`, `postgres_port`, `postgres_user`, `postgres_password`, `postgres_ssl` | | As in the history service |
| `PORT` | `3040` | |

The app backend needs `PARTNER_REFERRALS_URL` and `PARTNER_INTERNAL_KEY`; the
app nginx needs `PARTNER_REFERRALS_HOST` to serve `/partner-api/`.

## Tests

`npm test`. The Postgres suite runs when `postgres_host` is set.
