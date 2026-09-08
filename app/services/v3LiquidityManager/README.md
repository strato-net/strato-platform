# V3 Liquidity Manager

Monitors the corporate laddered liquidity positions in V3 (concentrated-liquidity) pools and alerts when they need repositioning. It does **not** submit transactions — repositioning stays a human action via `app/scripts/positionV3Liquidity.js` (the alert includes the exact command).

Supports multiple corporate accounts, each with its own pool list (`ACCOUNT_POOLS`). Every account-pool pair is checked, tracked, and alerted on independently — the alert names the account so you know whose credentials to reposition with.

## How it decides

For each configured account-pool pair, every poll:

1. Reads the pool (pool price `priceWad`, oracle `oraclePriceWad`, paused/disabled) — anonymous GET.
2. Reads the account's live positions via `GET /poolv3/positions` with an `X-Wallet-Address` header. That header is a **read identity only**: the service holds no Keycloak credentials, no OTP, no private key.
3. Computes the ladder center **μ** = median of each layer's geometric center `√(priceLower × priceUpper)` — stateless, always matches what's actually on chain.
4. Computes **ε** = `EPSILON_FACTOR ×` the innermost layer's half-width (auto-derived per pool; e.g. silver's ±1.5% inner layer with factor 0.75 → ε = ±1.13%). `EPSILON_ABS_PCT` pins an absolute value instead.
5. **Recenter alert** when `|oracle/μ − 1| > ε` — the oracle (what the reposition script centers on) has left the ladder's center band. The pool price deliberately does _not_ trigger this: it is supposed to converge to the oracle through the ladder via arbitrage.
6. **Warnings**: pool price vs oracle divergence beyond `DISLOCATION_PCT` (arb not keeping up / stale oracle), oracle price = 0, pool paused/disabled, no live positions.

Hysteresis: while a condition persists, it re-alerts only after `ALERT_COOLDOWN_HOURS`, if the drift doubles, or after the ladder is re-minted (μ changed). State lives in a small JSON file (`STATE_FILE`), keyed per account-pool pair.

## Notifications

Configure either or both (see `env.example`):

- **Email** — SendGrid HTTP API (`SENDGRID_API_KEY`, same key the backend contact form uses), `ALERT_EMAIL_FROM`/`ALERT_EMAIL_TO`.
- **Slack** — incoming webhook (`SLACK_WEBHOOK_URL`).

Every alert includes μ, oracle, pool price, the drift vs ε, all current findings, and a copy-paste reposition command. The command's `--widths` come from `LADDER_WIDTHS` when configured, otherwise they are reconstructed from the live positions (see Notes).

## Run

```bash
cd app/services/v3LiquidityManager
npm install
cp env.example .env   # fill in values
npm run once          # single check cycle, prints status JSON, exits (good for testing)
npm start             # long-running poller + /health endpoint
```

`GET :3007/health` returns 200 while cycles are running on schedule (and 500 if polling stalls or every pool errors), with the latest per-pool status as the body.

### Docker (EC2 deployment)

```bash
docker build -t v3-liquidity-manager .
docker run -d --name v3-liquidity-manager --restart unless-stopped \
  --env-file .env -p 3007:3007 \
  -e STATE_FILE=/data/state.json -v v3lm-state:/data \
  v3-liquidity-manager
```

## Notes

- The reposition command in alerts relies on the script's default layer weights (10/15/20/25/30); custom `--weights` cannot be reconstructed from chain and must be added by hand.
- Set `LADDER_WIDTHS` per pool so the command carries your canonical widths. The fallback reconstructs widths from the live positions, which include outward tick-snapping — re-minting from those makes the ladder creep wider by up to one tick-spacing per reposition.
- Finding the account addresses for `ACCOUNT_POOLS`: each is a corporate account's on-chain address — the `owner` shown on its positions (e.g. from `GET /poolv3/positions` while logged in as that account, or the NFT owner rows in Cirrus `BlockApps-PositionManagerV3-_owners`).
- Position NFTs are transferable: if a ladder's NFTs move to a different account, update `ACCOUNT_POOLS` — the old pair reports `no-ladder` and the new owner is unmonitored until added.
- Possible phase 2: unattended auto-repositioning. The script's wallet-key mode already supports non-interactive signing (Keycloak+OTP does not); the manager could invoke it when drift crosses ε. Deliberately out of scope for now — alerts keep a human in the loop.
