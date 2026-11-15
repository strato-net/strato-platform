# STRATO Partner Referral API

Lets a partner issue referral codes for its users and read how many people
each code brought in and how much they traded.

| | |
|---|---|
| Base URL | `https://partner-api.strato.nexus` |
| Authentication | `Authorization: Bearer <your API key>` on every call |
| Format | JSON in, JSON out |

Keep the API key on your servers. Do not put it in a browser or a mobile app.

## How it works

1. You ask for a referral code for one of your users (endpoint 1).
2. The user shares the link `https://app.strato.nexus/?ref=<code>`.
3. Someone opens the link and signs up on STRATO, or confirms the code with
   their own wallet. That account is now a referral of the code.
4. You read the results per code (endpoint 2).

## 1. Issue a referral code

`POST /partner-api/referrals/codes`

Each of your users has exactly one code. Calling again for the same user
returns the same code, so the call is safe to repeat.

| Field | Required | |
|---|---|---|
| `external_user_id` | yes | Your own id for the user, up to 320 characters |
| `email` | no | The user's email |
| `wallet` | no | The user's wallet address, 20 bytes in hex, with or without `0x` |
| `x_user_id` | no | The user's X (Twitter) id |

The optional fields are only used to stop a user from referring themselves:
a signup with the same wallet or email as the code's owner is not counted.
A later call can add fields that were not sent before.

```bash
curl -X POST https://partner-api.strato.nexus/partner-api/referrals/codes \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"external_user_id": "user-123", "email": "user@example.com"}'
```

```json
{
  "code": "ABCDEFGH23",
  "ref_link": "https://app.strato.nexus/?ref=ABCDEFGH23",
  "created": true
}
```

`created` is `true` the first time and `false` when the user already had the
code. Codes are 10 characters, capital letters and digits.

## 2. Read results

`GET /partner-api/referrals/metrics?from=<time>&to=<time>`

Returns one row per code you issued, for the period from `from` (included)
to `to` (excluded).

| Parameter | Required | |
|---|---|---|
| `from`, `to` | yes | ISO 8601 times, for example `2026-11-01T00:00:00Z`; `from` must be before `to` |
| `limit` | no | Codes per page, 1 to 1000, default 100 |
| `cursor` | no | The `next_cursor` of the previous page |

```bash
curl "https://partner-api.strato.nexus/partner-api/referrals/metrics?from=2026-11-01T00:00:00Z&to=2026-12-01T00:00:00Z" \
  -H "Authorization: Bearer $API_KEY"
```

```json
{
  "data_as_of": "2026-11-15T17:49:17.832Z",
  "codes": [
    {
      "code": "ABCDEFGH23",
      "external_user_id": "user-123",
      "referrals": 3,
      "traders": 1,
      "volume_usd": "1250.40"
    }
  ],
  "next_cursor": null
}
```

| Field | Meaning |
|---|---|
| `referrals` | Accounts that became a referral of the code during the period |
| `traders` | Referred accounts with counted activity during the period |
| `volume_usd` | USD value of that activity, as text with two decimals |
| `data_as_of` | How current the numbers are. Normally within seconds of now; if it is further back, the latest activity is not included yet |
| `next_cursor` | `null` on the last page; otherwise pass it as `cursor` to get the next page |

Codes with no referrals are listed too, with zeros.

## What is counted

- **Activity:** swaps, metal purchases, bridge-ins, and deposits into lending
  and CDP vaults by referred accounts, valued in USD at the price at the time.
- **One code per account:** an account belongs to the first code it used.
- **Wallet referrals:** a person who confirms a code with an existing wallet
  counts as a referral once that wallet has activity after confirming, and
  only its activity from then on is counted.
- **Gross volume:** the same funds moved twice count twice.

## Errors

Errors come as `{"error": {"code": "...", "message": "..."}}`.

| Status | Code | When |
|---|---|---|
| 400 | `BAD_REQUEST` | A field or parameter is missing or malformed; the message says which |
| 401 | `UNAUTHORIZED` | The key is missing or not known |
| 404 | | The path is not one of the two above; paths are case-sensitive, with no trailing slash |

## Health check

`GET /partner-api/health` returns `{"status": "ok"}` and needs no key.
