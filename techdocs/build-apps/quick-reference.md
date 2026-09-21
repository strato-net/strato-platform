# Quick Reference

A cheat sheet for building on STRATO. For the full references, see [Core Platform API](../reference/strato-node-api.md), [Cirrus](../reference/cirrus.md), [JSON-RPC](../reference/json-rpc.md) and [Transactions and Fees](../platform/transactions-and-fees.md).

## Networks

| | Mainnet (upquark) | Testnet (helium) |
|---|---|---|
| Host | `https://app.strato.nexus` | `https://app.testnet.strato.nexus` |
| JSON-RPC | `https://app.strato.nexus/rpc`, `https://noderpc.strato.nexus/rpc` | `https://app.testnet.strato.nexus/rpc` |
| `eth_chainId` | `0x7030addddcf2` (`123354377739506`) | `0xb165855668ca` (`195049586845898`) |
| `net_version` | `33056204878082667` | `114784819836269` |
| Explorer | [stratoscan.strato.nexus](https://stratoscan.strato.nexus) | |

## API paths

| Path | Purpose | Auth |
|---|---|---|
| `/rpc` | Ethereum JSON-RPC | None. `strato_*` methods are blocked on public endpoints. |
| `/cirrus/search/<table>` | Indexed state and events (PostgREST, `GET` only) | None |
| `/strato-api/eth/v1.2/*` | Core API: `account`, `block`, `block/last`, `transaction`, `transactionResult`, `metadata`, and more | None |
| `/bloc/v2.2/transaction[/parallel]` | Sign with your Vault key and submit | Bearer token |
| `/bloc/v2.2/transactions/results` | Transaction results by hash | None |
| `/bloc/v2.2/transaction/simulate` | Dry run (rate-limited) | None |
| `/bloc/v2.2/transaction/unsigned` | Build unsigned transactions | None |
| `/api/*` | App backend (DeFi operations) | Token for user data and writes |
| `/api/public/api-docs.json` | App API OpenAPI spec | None |
| `/api/docs` | App API Swagger UI | Browser login |

## Authentication

```bash
# Discovery document (the token_endpoint is inside)
curl -s https://keycloak.blockapps.net/auth/realms/mercata/.well-known/openid-configuration

# Client-credentials token (credentials from support.blockapps.net)
curl -s -u "$OAUTH_CLIENT_ID:$OAUTH_CLIENT_SECRET" \
  -d grant_type=client_credentials \
  "<token_endpoint>"

# Use it
curl -s -H "Authorization: Bearer $TOKEN" https://app.testnet.strato.nexus/api/user/me
```

For server-side `POST`s, use an HTTP client whose `User-Agent` nginx recognizes (curl, axios, python-requests, …). Node's built-in `fetch` fails the CSRF check.

## Fees

- **0.01 USDST** per transaction, or **1 voucher** if the sender holds one (paid through the Decider contract `…dec1de` to FeeCollector `…100d`)
- Charged before execution, so reverted transactions still pay
- No gas price to tune. Submitting N transactions costs N fees (approve plus an action = 0.02 USDST).

## Key addresses

The same on both networks (genesis). Full list: [Contract Addresses](contract-addresses.md).

| Contract | Address |
|---|---|
| USDST | `937efa7e3a77e20bbdbd7c0d32b6514f368c1010` |
| Voucher | `000000000000000000000000000000000000100e` |
| MercataGovernance | `0000000000000000000000000000000000000100` |
| Decider | `0000000000000000000000000000000000dec1de` |
| UserRegistry | `0000000000000000000000000000000000000720` |
| PriceOracle | `0000000000000000000000000000000000001002` |
| LendingPool | `0000000000000000000000000000000000001005` |
| LendingRegistry | `0000000000000000000000000000000000001007` |
| MercataBridge | `0000000000000000000000000000000000001008` |
| PoolFactory | `000000000000000000000000000000000000100a` |
| TokenFactory | `000000000000000000000000000000000000100b` |
| AdminRegistry | `000000000000000000000000000000000000100c` |
| FeeCollector | `000000000000000000000000000000000000100d` |
| CDPEngine | `0000000000000000000000000000000000001011` |
| CDPRegistry | `0000000000000000000000000000000000001012` |
| CDPVault | `0000000000000000000000000000000000001013` |

## Cirrus

| Data | Table |
|---|---|
| Contract state | `BlockApps-<Contract>` |
| Mapping | `BlockApps-<Contract>-<mapping>` (`address`, `key`, `key2`, `value`) |
| Event | `BlockApps-<Contract>-<Event>` |

```bash
H=https://app.testnet.strato.nexus/cirrus/search

# Token by address
curl -s "$H/BlockApps-Token?address=eq.937efa7e3a77e20bbdbd7c0d32b6514f368c1010&select=address,_name,_symbol,customDecimals"

# Token balance
curl -s "$H/BlockApps-Token-_balances?address=eq.<token>&key=eq.<user>&select=value::text"

# All balances for a user, with token metadata
curl -s "$H/BlockApps-Token-_balances?key=eq.<user>&select=address,balance:value::text,token:BlockApps-Token(_symbol,customDecimals)"

# Voucher balance
curl -s "$H/BlockApps-Voucher-_balances?address=eq.000000000000000000000000000000000000100e&key=eq.<user>&select=value::text"

# Swap pools
curl -s "$H/BlockApps-Pool?select=address,tokenA,tokenB,tokenABalance::text,tokenBBalance::text,lpToken,isStable&limit=20"

# Oracle prices
curl -s "$H/BlockApps-PriceOracle-prices?address=eq.0000000000000000000000000000000000001002&select=asset:key,price:value::text"

# CDP vaults for a user
curl -s "$H/BlockApps-CDPEngine-vaults?address=eq.0000000000000000000000000000000000001011&key=eq.<user>&select=asset:key2,Vault:value"
```

Operators: `eq.`, `in.(a,b)`, `gt.`, `order=col.desc`, `limit`, `offset`, `alias:col`, `::text`, and embedding `rel:fkey_name(cols)`.

## JSON-RPC

```bash
R=https://app.testnet.strato.nexus/rpc
rpc() { curl -s -X POST $R -H 'Content-Type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$1\",\"params\":$2}"; }

rpc eth_chainId '[]'
rpc eth_blockNumber '[]'
rpc eth_call '[{"to":"0x937efa7e3a77e20bbdbd7c0d32b6514f368c1010","data":"0x95d89b41"},"latest"]'   # symbol()
rpc eth_getTransactionCount '["0x<address>","latest"]'
rpc eth_getTransactionReceipt '["0x<hash>"]'
```

Transaction rules:

- Legacy EIP-155 transactions only
- `gasPrice` 0 and an explicit gas limit (the app uses `1000000`)
- Submit with `eth_sendRawTransaction`; `eth_sendTransaction` isn't supported

viem write:

```typescript
await walletClient.writeContract({ address, abi, functionName, args, type: "legacy", gasPrice: 0n, gas: 1_000_000n });
```

## Bloc

```bash
# Submit (Vault signs for the token's account)
curl -s -X POST "https://app.testnet.strato.nexus/bloc/v2.2/transaction/parallel?resolve=true" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"txs":[{"type":"FUNCTION","payload":{"contractAddress":"<address>","method":"<method>","args":{}}}],"txParams":{"gasLimit":32100000000,"gasPrice":1}}'

# Results: [{ status: Success|Failure|Pending, hash, txResult, data }]
curl -s -X POST https://app.testnet.strato.nexus/bloc/v2.2/transactions/results \
  -H 'Content-Type: application/json' -d '["<hash>"]'
```

Swap `/transaction/parallel` for `/transaction/simulate` to dry-run the same body.

## Common contract calls

These are the calls the app backend makes (`app/backend/src/api/services`). Amounts are base-unit integers (18 decimals for USDST and the genesis tokens). Each row is one transaction and one fee; "Approve first" is an extra transaction.

| Action | Approve first (token → spender) | Call |
|---|---|---|
| Transfer | none | `Token.transfer(to, value)` |
| CDP deposit | collateral → CDPVault `…1013` | `CDPEngine(…1011).deposit(asset, amount)` |
| CDP mint | none | `CDPEngine.mint(asset, amountUSD)` |
| CDP repay | USDST → CDPEngine `…1011` | `CDPEngine.repay(asset, amountUSD)` |
| Swap | input token → pool | `Pool.swap(isAToB, amountIn, minAmountOut, deadline)` |
| Bridge out | token → MercataBridge `…1008` | `MercataBridge.requestWithdrawal(externalChainId, externalRecipient, externalToken, stratoToken, stratoTokenAmount)` |
| Lending: supply collateral | collateral → CollateralVault `…1003` | `LendingPool(…1005).supplyCollateral(asset, amount)` |
| Lending: borrow | none | `LendingPool.borrow(amount)` |
| Lending: repay | USDST → LiquidityPool `…1004` | `LendingPool.repay(amount)` |
| Rewards | none | `Rewards.claimAllRewards()` |

`Pool.swap` requires `minAmountOut > 0` and `block.timestamp <= deadline`, with `deadline` in Unix seconds. The Rewards contract address differs per network; see [Contract Addresses](contract-addresses.md#per-network-contracts).

## App API endpoints

| Method and path | Body |
|---|---|
| `GET /api/user/me` | Returns `{ userAddress, isAdmin, userName, isNewUser }` |
| `GET /api/tokens/balance` | |
| `GET /api/vouchers/balance` | |
| `POST /api/tokens/transfer` | `{ address, to, value }`, returns `{ status, hash }` |
| `GET /api/trade/quote` | `?tokenIn&tokenOut&amount&type` |
| `POST /api/swap` | `{ poolAddress, isAToB, amountIn, minAmountOut }` |
| `POST /api/cdp/deposit` | `{ asset, amount }` |
| `POST /api/cdp/mint` | `{ asset, amount }` |
| `POST /api/bridge/requestWithdrawal` | `{ externalChainId, externalToken, stratoToken, stratoTokenAmount, externalRecipient }` |
| `POST /api/rewards/claim-all` | |

More: [Integration Guide](integration.md#common-endpoints) and `/api/public/api-docs.json`.

## Errors

| Message or status | Cause | Fix |
|---|---|---|
| `403 Authorization header is provided but the bearer token is invalid or expired` | nginx rejected the JWT | Get a new token |
| `403 {"error": "Authentication required. Please log in and try again."}` | A `POST` was treated as a browser request (CSRF) | Use curl, axios or another API client User-Agent |
| `401` | The endpoint needs a token and none was sent | Add `Authorization: Bearer` |
| `Insufficient gas fee coverage` | App backend: USDST + vouchers can't cover 0.01 × transactions | Fund the account |
| `low tx nonce (expected: N, actual: M)` | Nonce reused | Resubmit with nonce N |
| `403 method not available on the public RPC endpoint` | A `strato_*` method on public `/rpc` | Use `/bloc/v2.2/transaction/simulate` or your own node |
| `eth_sendTransaction not supported, use eth_sendRawTransaction` | Unsigned send to `/rpc` | Sign locally or in a wallet |
| `Method not found: eth_feeHistory` (or `eth_maxPriorityFeePerGas`) | EIP-1559 fee lookup | Send `type: "legacy"` with `gasPrice: 0` |
| Cirrus `{"code":"42P01", …}` | Table doesn't exist | Check the `BlockApps-<Contract>[-<name>]` spelling |

## Reference implementation

- `app/backend/src/utils/txBuilder.ts`, `txHelper.ts`, `appApiHelper.ts`
- `app/backend/src/api/services/*.service.ts`
- `app/ui/src/pages/Transfer.tsx` (external-wallet legacy transaction)
