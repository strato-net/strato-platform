# Livetest brief: Safe VestingPool on STRATO helium, driven by an agent with a raw key

_Written 2026-11-05 for an autonomous agent. Every statement here was verified against the repo and helium on that date; treat anything you observe that contradicts it as a finding, not as a reason to improvise._

## 0. What you are doing and what done looks like

You will deploy the ported Safe `VestingPool` and its STRATO-side `VestingPoolManager` to the **helium testnet** from a single private key, create a set of beneficiary keys, run the vesting lifecycle end to end (create, cliff, linear accrual, claim, pause, unpause, cancel, sweep), cross-check every result against the chain and Cirrus, and write a report.

Done means: a report (section 9) listing every address and transaction, every assertion in section 7 marked pass or fail with the observed values, and every discrepancy described precisely. A failed assertion is a valid outcome; a skipped one is not.

Hard rules:

- **Testnet only.** Endpoints are `https://app.testnet.strato.nexus/...`. Never use `app.strato.nexus` or `noderpc.strato.nexus`.
- **Do not modify** `app/contracts/concrete/Tokenomics/VestingPool.sol` or `VestingPoolManager.sol`. They are the artifacts under test.
- **Never print a private key** in logs or the report. Keep generated keys in a local file (`livetest-keys.json`, gitignored or outside the repo) and refer to keys by their address.
- Stop and report when you hit a step that needs an admin vote (section 4, Phase B). Do not try to obtain credentials.

## 1. Inputs you receive from the operator

| Item | Value |
|---|---|
| Operator private key | provided out of band, 32-byte hex |
| Its funding | USDST for fees (every transaction by any key costs 0.01 USDST); STRATO only matters for Phase B |
| Network | helium testnet, chain id `195049586845898` (`0xb165855668ca`), network id `114784819836269` |
| JSON-RPC | `https://app.testnet.strato.nexus/rpc` |
| REST (core API) | `https://app.testnet.strato.nexus/strato-api/eth/v1.2` |
| Cirrus (indexed state, public GET) | `https://app.testnet.strato.nexus/cirrus/search/<Table>` |
| Repo | `strato-platform`, branch `feature/safe-vesting-pool-port` |
| Contracts | `app/contracts/concrete/Tokenomics/VestingPool.sol`, `VestingPoolManager.sol` |
| Background | `design-documents/handoff-safe-vesting-pool-port.md` (read sections 3, 5 and 7 first) |
| Helium STRATO token (Phase B only) | `8ee9a3391e38176feebf5d43cb2c1d6c4f728b04`, **paused**: transfers need an AdminRegistry whitelist |
| USDST | `937efa7e3a77e20bbdbd7c0d32b6514f368c1010` |
| AdminRegistry | `000000000000000000000000000000000000100c` |

Cloudflare blocks the default Python/urllib user agent on `app.testnet.strato.nexus`; send a browser-like `User-Agent` on every HTTP request.

## 2. How to transact with a raw key on STRATO

STRATO runs SolidVM, not the EVM. Function calls and reads work through the Ethereum JSON-RPC with ABI encoding; **contract creation does not** (creation with EVM bytecode is rejected) and must be sent as a STRATO-format transaction carrying the Solidity source. Both formats are signed with your secp256k1 key and submitted with `eth_sendRawTransaction`.

### 2.1 Fees and nonces

- Every transaction pays a flat **0.01 USDST** from the signing address, charged before execution, so a reverted transaction still pays. A key with no USDST cannot send anything. Fund each generated key with 1 USDST before it transacts.
- Nonce: `eth_getTransactionCount(address, "latest")` or `GET /strato-api/eth/v1.2/account?address=<hex>` (field `nonce`). Transactions from one key must carry consecutive nonces.
- Results: `eth_getTransactionReceipt(hash)`, or `GET /strato-api/eth/v1.2/transactionResult/<hash>` which includes `status`, `txResult.message`, `txResult.contractsCreated` and decoded return values. Poll until status is not `Pending`.

### 2.2 Reads

- `eth_call` with a 4-byte ABI selector works against SolidVM contracts. Build ABI fragments from the Solidity source (section 5 lists the signatures). Use viem's `readContract` or ethers.
- Cirrus: `GET /cirrus/search/<Table>?<PostgREST filters>`. Tables used here are listed in section 6. Big integers must be read with a `::text` cast (`select=value::text`) or they lose precision.

### 2.3 Writes, format A: Ethereum legacy transaction (function calls only)

Known-working path (the web app uses it). Legacy EIP-155 only, `gasPrice: 0`, explicit `gas` (use `1000000`), chain id `195049586845898`, `data` = ABI-encoded call. The node matches the selector to the SolidVM function and ABI-decodes the arguments. A transaction with a `value` and empty `data` is a **USDST transfer**, which is how you fund the generated keys.

```ts
await walletClient.writeContract({ address, abi, functionName, args, type: "legacy", gasPrice: 0n, gas: 1_000_000n });
```

Confirm array arguments (`addVestings`) decode correctly with a two-entry batch before relying on it; if they do not, use format B for that call.

### 2.4 Writes, format B: STRATO legacy transaction (needed for contract creation)

An RLP list, signed over its keccak256, submitted hex-encoded with `eth_sendRawTransaction` (the node recognises the 10-item STRATO layout). Derived from `strato/core/blockapps-data/src/Blockchain/Data/TransactionDef.hs`.

**Unsigned items:**

| Position | Contract creation | Function call |
|---|---|---|
| 0 | integer `1` | integer `2` |
| 1 | `nonce` | `nonce` |
| 2 | `gasLimit` (use `8000000` for creation) | `gasLimit` (`1000000`) |
| 3 | `contractName` (UTF-8 string, e.g. `VestingPoolManager`) | `to` (20 raw bytes, no `0x`) |
| 4 | `args`: list of UTF-8 strings | `funcName` (UTF-8 string) |
| 5 | `network`: the string `STRATO` | `args`: list of UTF-8 strings |
| 6 | `code`: the full Solidity source as a UTF-8 string | `network`: `STRATO` |

Each argument string is the JSON serialisation of the value: an address is a quoted hex string with no `0x` (the string `"8ee9...b04"` including the quote characters), an integer is a bare decimal string, a boolean is `true` or `false`, an array is a JSON array of those. The repo's own example is `"args": ["\"88a4d5...6966\"", "1000000000000000000"]`.

**Signing:** `digest = keccak256(rlp(items ++ [chainId, 0, 0]))` with `chainId = 195049586845898` (EIP-155 style; helium also accepts the form without the three trailing items, but use this one). Sign the digest with secp256k1; get `r`, `s`, and the recovery id `recId` (0 or 1). Then `v = chainId * 2 + 35 + recId`.

**Signed transaction:** `rlp(items ++ [v, r, s])`, ten items, hex-encoded with `0x`, passed to `eth_sendRawTransaction`. The transaction hash is keccak256 of that RLP.

RLP item rules: integers are minimal big-endian bytes (zero encodes as the empty string), strings are their UTF-8 bytes, the address is 20 bytes, `args` is a nested list. ethers v6 (`encodeRlp`, `keccak256`, `SigningKey`) or viem (`toRlp`, `keccak256`, `sign`) can build all of this; a sketch is in section 10.

**JSON alternative** for the same signed transaction, if the RPC path rejects it: `POST /strato-api/eth/v1.2/transaction` with body `{ "nonce", "gasLimit", "contractName", "args", "network", "code", "chainId", "r", "s", "v" }` for creation, or `{ "nonce", "gasLimit", "to", "funcName", "args", "network", "chainId", "r", "s", "v" }` for a call; `r`, `s`, `v` are hex strings without `0x`. The response is the transaction hash.

**Validate your signer before deploying anything:** send one cheap format-B call from the operator key, for example `transfer` of 1 atom of USDST to yourself (`to` = USDST, `funcName` = `transfer`, args `["\"<your address>\"", "1"]`), confirm the receipt shows success and that `eth_getTransactionByHash` reports your address as `from`. If the signer is wrong this is where you find out, for 0.01 USDST.

## 3. Sources to deploy

Flatten with the repo's importer so every import is inlined in dependency order. From `app/contracts` (it has `node_modules` with `blockapps-rest`):

```js
const { importer } = require("blockapps-rest");
let src = await importer.combine(require("path").resolve("concrete/Tokenomics/VestingPoolManager.sol"));
src = Buffer.isBuffer(src) ? src.toString() : typeof src === "object" ? Object.values(src).map(String).map(c => c.replace(/^.*?\.sol,\s*/i, "")).join("\n") : String(src);
```

Strip `//` and `/* */` comments except lines containing `SPDX-License-Identifier` (the deploy script `app/contracts/deploy/deploy-vesting-manager.js` shows the exact function; reuse it). Expected contracts in the manager artifact: `VestingPool, Context, Authorizable, AdminRegistry, Ownable, VestingPoolManager`, about 25 KB. Its sha256 on the branch at the time of writing was `2864cf594322e115e0148afc3c7fb39890de0b6fc9d8078678cbb5a6bbadce65`; a different hash means the source changed, which you should note, not fix.

**Test token** (Phase A). Create `TestToken.sol` next to the manager, flatten it the same way (expected contracts: `Context, ERC20, TestToken`), then delete the file from the repo tree so it is not committed:

```solidity
import "../../abstract/ERC20/ERC20.sol";

// Livetest-only ERC-20: unpaused, no whitelist, minted to the deployer.
contract TestToken is ERC20 {
    constructor(uint256 supply) ERC20("Vesting Test Token", "VTT") {
        _mint(msg.sender, supply);
    }
}
```

This exact contract compiles and transfers on solid-vm-cli. The repo's ERC-20 reverts on failure and returns `true` on success, which is what the pool's `require(transfer(...))` expects.

Creation transactions: `TestToken` with args `["1000000000000000000000000"]` (1,000,000 tokens, 18 decimals); `VestingPoolManager` with args `["\"<TestToken address>\"", "\"<operator address>\""]`. The manager's constructor deploys the pool, so its creation yields **two** contracts, the pool first. Read `pool()` on the manager with `eth_call` rather than trusting the first created address in the receipt.

## 4. Two phases, and why

**Phase A, self-contained (required).** Vest the `TestToken` you deploy. Everything is under the operator key: no admin votes, no whitelists, no waiting on humans. This exercises the pool and manager completely.

**Phase B, real STRATO (optional, only if the operator pre-arranges it).** Helium's STRATO token is **paused**, and while paused `transfer` succeeds only for the token owner or for callers the AdminRegistry has whitelisted for `(token, "transfer")`. Two consequences: your operator key cannot move STRATO into a pool unless it is whitelisted, and the pool cannot pay claims unless **the pool address** is whitelisted. Both are admin votes you cannot cast. If the operator wants Phase B, ask them to (1) send STRATO directly to the pool address you report after Phase A's deployment, and (2) vote the whitelist for the pool, then confirm in Cirrus (`BlockApps-AdminRegistry-whitelist` with `key=<token>`, `key2=transfer`, `key3=<pool>`) before you create STRATO vestings. The manager does not need whitelisting; it never calls the token.

## 5. Interfaces (ABI fragments for format A and `eth_call`)

VestingPool:

```
function token() view returns (address)
function poolManager() view returns (address)
function totalTokensInVesting() view returns (uint256)
function tokensAvailableForVesting() view returns (uint256)
function vestingHash(address account, uint8 curveType, bool managed, uint16 durationWeeks, uint64 startDate, uint128 amount) view returns (bytes32)
function calculateVestedAmount(bytes32 vestingId) view returns (uint128 vestedAmount, uint128 claimedAmount)   // reverts "Vesting not active yet" before startDate
function claimVestedTokens(bytes32 vestingId, address beneficiary, uint128 tokensToClaim)                       // caller must be the vesting account; 340282366920938463463374607431768211455 claims all
```

VestingPoolManager (owner only, except the views):

```
function owner() view returns (address)
function pool() view returns (address)
function addVesting(address account, uint8 curveType, bool managed, uint16 durationWeeks, uint64 startDate, uint128 amount)
function addVestings(address[] accounts, uint128[] amounts, bool managed, uint16 durationWeeks, uint64 startDate)
function cancelVesting(bytes32 vestingId)
function pauseVesting(bytes32 vestingId)
function unpauseVesting(bytes32 vestingId)
function transferOwnership(address newOwner)
```

Semantics you must know: `curveType` 0 is linear. `startDate` is unix seconds; `durationWeeks` is whole weeks (`0` means fully vested at start). The cliff is a future `startDate`. Only `managed == true` vestings can be paused or cancelled. Cancel freezes what has vested and returns the rest to the pool's available balance. Unpause shifts `startDate` forward by the paused time. The owner of the manager in this livetest is the operator key, so owner calls execute directly; a failed owner-only call reverts generically (the repo's Ownable routes failures toward an AdminRegistry that, here, is an ordinary address), so assert state after owner calls rather than parsing messages. The pool's own messages do propagate on direct pool calls.

## 6. Cirrus tables (public GET, no token)

| Table | Use |
|---|---|
| `BlockApps-VestingPool?address=eq.<pool>&select=totalTokensInVesting::text` | committed total |
| `BlockApps-VestingPool-vestings?address=eq.<pool>&select=key,value` | one row per vesting; `key` is the id, `value` is the struct as JSON (`account, curveType, managed, durationWeeks, startDate, amount, amountClaimed, pausingDate, cancelled`) |
| `BlockApps-VestingPool-AddedVesting`, `-ClaimedVesting`, `-PausedVesting`, `-UnpausedVesting`, `-CancelledVesting` (`?address=eq.<pool>`) | event log; note the event field `id` is shadowed by the table's row id, so take ids from the vestings table, not from events |
| `BlockApps-VestingPoolManager?address=eq.<manager>&select=pool,_owner` | manager wiring (`_owner`, with the underscore) |
| `BlockApps-TestToken-_balances?address=eq.<token>&key=eq.<holder>&select=value::text` | token balance of a holder (the pool's row appears after its first inbound transfer) |

Two known SolidVM discrepancies: the pool's public `vestings(id)` getter returns empty fields over RPC, so use the table or `calculateVestedAmount`; and a revert raised by the token inside a pool call reaches the caller as a raw revert rather than an `Error(string)`.

## 7. Test plan and assertions

Use short real durations so the run finishes in a few hours: 0 weeks for instant unlock, 1 week and 2 weeks for linear accrual checked at minute scale, and cliffs of 10 to 20 minutes. Accrual is per second, so for a vesting of amount `A` over `W` weeks the expected vested amount at elapsed `e` seconds is `floor(A * e / (W * 604800))`. Because you cannot pin the exact block timestamp of a read, compute the expectation at the two bounding timestamps around your call and accept any value in that range.

**P0 Preflight.** `eth_chainId` equals `0xb165855668ca`; `eth_blockNumber` advances; operator USDST balance is at least 20; operator nonce recorded. Signer validation from section 2.4.

**P1 Keys.** Generate six secp256k1 keys: team-A, team-B, advisor, investor-1, investor-2, treasury. Fund each with 1 USDST from the operator (format A value transfer). Assert each balance.

**P2 TestToken.** Deploy; assert `balanceOf(operator) == 1e24`, `symbol() == "VTT"`, `decimals() == 18`.

**P3 Manager and pool.** Deploy `VestingPoolManager(token, operator)`. Assert `manager.owner() == operator`, `pool = manager.pool()`, `pool.poolManager() == manager`, `pool.token() == token`, and the Cirrus manager row shows the same `pool` and `_owner`.

**P4 Funding and the under-funded path.** Transfer 100,000 VTT to the pool; assert `tokensAvailableForVesting() == 100000e18`. Call `addVesting` for 200,000 VTT and assert it fails and `totalTokensInVesting` stays 0.

**P5 Creation.** With `T0 = now + 120 s` as the TGE:

| Vesting | Account | managed | durationWeeks | startDate | amount VTT |
|---|---|---|---|---|---|
| investor-1 | investor-1 | false | 0 | T0 | 10,000 |
| investor-2 | investor-2 | false | 0 | T0 | 20,000 |
| advisor | advisor | false | 1 | T0 | 7,000 |
| team-A | team-A | true | 2 | T0 + 900 | 30,000 |
| team-B | team-B | true | 2 | T0 + 900 | 25,000 |

Create investors and advisor with one `addVestings` each where the shape allows (both investors in one call), team with one call. Assert: five rows in the vestings table whose fields equal the inputs; `totalTokensInVesting == 92000e18`; `vestingHash(params)` equals each row's `key`; duplicate creation of investor-1 reverts and changes nothing; `calculateVestedAmount` on every id reverts with "Vesting not active yet" before T0.

**P6 Claims.**
- At T0 + 60 s: `calculateVestedAmount(investor-1)` returns `(10000e18, 0)`. investor-1 claims all with the sentinel; assert its token balance is 10,000 and `totalTokensInVesting` dropped by 10,000. investor-2 claims exactly 5,000 then later the rest.
- advisor at about T0 + 600 s: expected vested in the bounding range for `e` around 600 s of 604,800; claim all; assert balance equals the returned vested amount and `amountClaimed` matches. Claim again immediately and assert the second payout is small and consistent with the elapsed seconds.
- Negative: advisor claiming more than vested reverts "Trying to claim too many tokens"; investor-1 claiming advisor's id reverts "Can only be claimed by vesting owner"; any claim with beneficiary `0x0` reverts "Cannot claim to 0-address"; team-A claiming before T0 + 900 reverts "Vesting not active yet".

**P7 Manager actions.**
- Pause team-A before its start, wait past the start, unpause: assert its `startDate` moved to the unpause time (pausing before start sets `pausingDate = startDate`) and `calculateVestedAmount` is 0 right after.
- After T0 + 900: pause team-B, wait 300 s, unpause; assert `startDate` increased by about 300 s and vested did not grow while paused.
- Cancel team-A at T0 + 1500: assert its vested amount freezes (two reads 120 s apart return the same value), `totalTokensInVesting` dropped by the unvested remainder, team-A can still claim exactly the frozen amount, and `unpauseVesting(team-A)` reverts "Vesting has been cancelled and cannot be unpaused".
- `cancelVesting(advisor)` reverts because it is unmanaged, with state unchanged. The pool's message is "Only managed vestings can be cancelled"; through the manager you may only see a generic revert, which is acceptable.
- From a non-owner key, `addVesting` and `cancelVesting` on the manager revert and change nothing; a direct `pool.addVesting` from the operator reverts "Can only be called by pool manager".
- `transferOwnership(treasury)` from the operator, then `addVesting` from treasury succeeds and from the operator fails; transfer it back.

**P8 Sweep.** After the cancel, `tokensAvailableForVesting()` equals the returned remainder plus the 8,000 never committed. Create a zero-week unmanaged vesting of exactly that amount to treasury, claim it from treasury, assert available is 0 and the treasury balance rose by that amount.

**P9 Consistency.** `totalTokensInVesting` equals the sum over the vestings table of `amount - amountClaimed` for live rows plus `vested - amountClaimed` for cancelled rows. Token balance of the pool equals `totalTokensInVesting` plus available. Event counts: 6 AddedVesting (5 plus the sweep), ClaimedVesting equals your claim count, 2 Paused, 2 Unpaused, 1 Cancelled.

## 8. Timing and robustness

- Blocks on helium are transaction-driven; a quiet chain produces a block when your transaction arrives, so do not wait for "the next block" as a clock. Use wall-clock sleeps and read `block.timestamp` from the receipt's block when you need the exact time a write executed.
- Expect indexing lag of a few seconds between a receipt and the Cirrus row.
- If a transaction result is `Failure`, record `txResult.message` verbatim.
- If `eth_sendRawTransaction` rejects the STRATO-format RLP, try the JSON submission in section 2.4; if both fail, stop at that point and report exactly what was sent (minus the key) and what came back.

## 9. Report format

1. Environment: chain id, block range, operator address, USDST spent.
2. Addresses: token, manager, pool, six beneficiary keys (addresses only).
3. Transaction log: one row per transaction with step, from, function or `create <Name>`, hash, status, message if failed, block timestamp.
4. Assertion table: every assertion from section 7 with expected, observed, pass or fail.
5. Discrepancies and surprises, each with the evidence to reproduce it.
6. Keys file location and a reminder that it holds private keys.

## 10. Signer sketch for format B (ethers v6)

```ts
import { encodeRlp, keccak256, SigningKey, toBeHex, toUtf8Bytes, hexlify, getBytes } from "ethers";

const CHAIN_ID = 195049586845898n;
const int = (n: bigint | number) => (BigInt(n) === 0n ? "0x" : toBeHex(BigInt(n)));          // minimal big-endian, zero = empty
const str = (s: string) => hexlify(toUtf8Bytes(s));
const addr = (a: string) => "0x" + a.replace(/^0x/, "").toLowerCase();                        // 20 raw bytes

export function signStratoCreate(key: SigningKey, nonce: number, name: string, args: string[], source: string) {
  const items = [int(1), int(nonce), int(8_000_000), str(name), args.map(str), str("STRATO"), str(source)];
  return finish(key, items);
}
export function signStratoCall(key: SigningKey, nonce: number, to: string, funcName: string, args: string[]) {
  const items = [int(2), int(nonce), int(1_000_000), addr(to), str(funcName), args.map(str), str("STRATO")];
  return finish(key, items);
}
function finish(key: SigningKey, items: any[]) {
  const digest = keccak256(encodeRlp([...items, int(CHAIN_ID), int(0), int(0)]));
  const sig = key.sign(digest);                                   // r, s, yParity
  const v = CHAIN_ID * 2n + 35n + BigInt(sig.yParity);
  const raw = encodeRlp([...items, int(v), int(BigInt(sig.r)), int(BigInt(sig.s))]);
  return { raw, hash: keccak256(raw), digest };
}
// Submit: { "jsonrpc": "2.0", "id": 1, "method": "eth_sendRawTransaction", "params": [raw] }
```

Self-checks before the first send: `SigningKey.recoverPublicKey(digest, sig)` yields the operator's address; `decodeRlp(raw)` has ten items; the `args` element decodes back to your strings; the hash you compute equals the hash the node returns.
