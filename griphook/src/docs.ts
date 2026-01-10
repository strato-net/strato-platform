import { GriphookConfig } from "./config.js";

export const endpointsOverview = `# STRATO API surface

Authentication
- Run 'griphook login' to authenticate via browser OAuth.
- Requires OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET, and OPENID_DISCOVERY_URL for OAuth configuration.
- Tokens are cached and refreshed automatically before expiration.
- Base URL defaults to http://localhost:3001/api. Override with STRATO_API_BASE_URL.

User & Admin
- GET /user/me – current address, admin flag, username.
- GET /user/admin – list admins. POST /user/admin, DELETE /user/admin – add/remove admin.
- GET /user/admin/issues – open governance issues; POST /user/admin/vote, /vote/by-id, /dismiss.
- GET /user/admin/contract/search?search=... and /contract/details?address=...

Tokens & Balances
- GET /tokens (status filter, select), GET /tokens/{address}, GET /tokens/stats.
- GET /tokens/balance?address=eq.<addr>, GET /tokens/transferable.
- POST /tokens – create token (name, symbol, initialSupply, description, customDecimals, optional images/files).
- POST /tokens/transfer, /approve, /transferFrom, /setStatus.
- GET /vouchers/balance.
- Token v2: GET /tokens/v2 (status), /earning-assets, /balance-history/{tokenAddress}, /net-balance-history, /borrowing-history, /pool-price-history/{poolAddress}.

Swaps & Liquidity
- GET /swap-pools (with pagination/order), /swap-pools/{poolAddress}, /swap-pools/{tokenA}/{tokenB}.
- GET /swap-pools/tokens and /swap-pools/tokens/{tokenAddress}.
- GET /swap-pools/positions – LP positions.
- POST /swap-pools – create pool; POST /swap-pools/{pool}/liquidity (dual); POST /swap-pools/{pool}/liquidity/single; DELETE /swap-pools/{pool}/liquidity.
- POST /swap – execute swap; POST /swap-pools/set-rates (admin).
- GET /swap-history/{poolAddress}.

Lending Pools
- GET /lending/pools – registry. GET /lending/liquidity – wallet & pool balances.
- Collateral: GET /lending/collateral; POST /lending/collateral; DELETE /lending/collateral; POST /lending/collateral/withdraw-max.
- Loans: GET /lending/loans; POST /lending/loans (borrow); POST /lending/loans/borrow-max; PATCH /lending/loans (repay); POST /lending/loans/repay-all.
- Pool liquidity: POST /lending/pools/liquidity; DELETE /lending/pools/liquidity; POST /lending/pools/withdraw-all.
- Liquidations: GET /lending/liquidate; GET /lending/liquidate/near-unhealthy?margin=0.2; POST /lending/liquidate/{id} or /lending/liquidations/{id}.
- Admin: POST /lending/admin/configure-asset; /sweep-reserves; /set-debt-ceilings; /pause; /unpause.
- Safety module: GET /lending/safety/info; POST /lending/safety/stake; /cooldown; /redeem; /redeem-all.
- Metrics: GET /lending/interest.

CDP Engine
- Vaults: GET /cdp/vaults; GET /cdp/vaults/{asset}.
- Collateral: POST /cdp/deposit; POST /cdp/withdraw; POST /cdp/get-max-withdraw; POST /cdp/withdraw-max.
- Debt: POST /cdp/get-max-mint; POST /cdp/mint; POST /cdp/mint-max; POST /cdp/repay; POST /cdp/repay-all.
- Liquidations: POST /cdp/liquidate; GET /cdp/liquidatable; POST /cdp/max-liquidatable.
- Assets & admin: GET /cdp/config/{asset}; GET /cdp/assets?supported=true|false; POST /cdp/asset-debt-info.
- Admin config: POST /cdp/admin/set-collateral-config; /set-collateral-config-batch; /set-asset-paused; /set-asset-supported; /set-global-paused; GET /cdp/admin/global-paused; GET /cdp/admin/all-configs.
- Bad debt & juniors: GET /cdp/bad-debt; GET /cdp/bad-debt/juniors/{account}; POST /cdp/bad-debt/open-junior-note; /top-up-junior-note; /claim-junior-note.
- Metrics: GET /cdp/stats; GET /cdp/interest.

Bridge
- GET /bridge/networkConfigs – enabled chains.
- GET /bridge/bridgeableTokens/{chainId}.
- POST /bridge/requestWithdrawal; POST /bridge/requestAutoSave.
- GET /bridge/transactions/deposit and /withdrawal (params: limit, offset, order, stratoToken, externalChainId, context=admin).
- GET /bridge/withdrawalSummary.

Rewards
- GET /rewards/pending; POST /rewards/claim.
- GET /rewards/pools; GET /rewards/pools/by-lp-token/{lpToken}; GET /rewards/pools/{poolId}/balance.
- GET /rewards/state.
- Rewards contract: GET /rewards/overview; GET /rewards/activities; GET /rewards/activities/{userAddress}; POST /rewards/claim-all; POST /rewards/claim/{activityId}; GET /rewards/leaderboard.

Oracle & Protocol Fees
- GET /oracle/price?asset=...; POST /oracle/price; GET /oracle/price-history/{assetAddress}.
- GET /protocol-fees/revenue; GET /protocol-fees/revenue/{protocol}; GET /protocol-fees/revenue/period/{period}?protocol=cdp|lending|swap|gas.

Events & RPC
- GET /events (order/limit/offset filters); GET /events/contracts.
- POST /rpc/{chainId} – pass JSON-RPC payload in body.

Config & Health
- GET /config – public client config (e.g., Wagmi projectId, networkId).
- GET /health – backend health.
`;

export function buildConfigDoc(config: GriphookConfig): string {
  const authInfo = config.oauth
    ? `- OAuth client ID: ${config.oauth.clientId}
- OpenID discovery: ${config.oauth.openIdDiscoveryUrl}`
    : `- Auth mode: browser (run 'griphook login' to authenticate)`;

  return `# Griphook configuration

- Node URL: ${config.nodeUrl}
- API base: ${config.apiBaseUrl}
${authInfo}
- HTTP timeout: ${config.timeoutMs}ms

Authentication modes:
1. Browser login (recommended): Run 'griphook login' to authenticate via browser
2. Token mode: Set STRATO_ACCESS_TOKEN with a pre-obtained access token

Optional environment variables:
- STRATO_NODE_URL (default http://localhost)
- STRATO_API_BASE_URL (default http://localhost:3001/api)
- STRATO_HTTP_TIMEOUT_MS (default 15000)
- GRIPHOOK_HTTP_ENABLED (default true)
- GRIPHOOK_HTTP_HOST (default 127.0.0.1)
- GRIPHOOK_HTTP_PORT (default 3005)
- GRIPHOOK_HTTP_PATH (default /mcp)
- GRIPHOOK_HTTP_SSE_PATH (default {path}/events)
`;
}
