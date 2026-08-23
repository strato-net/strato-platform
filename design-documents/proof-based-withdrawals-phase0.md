# Proof-Based Withdrawals — Phase 0 Spec

Status: draft. Phase 0 freezes the canonical formats every other phase depends on. Once this doc lands, downstream work (STRATO-core receipts root, on-chain light client, Solidity vault, off-chain relayer, modified `MercataBridge.sol`) can run in parallel.

Source references in `strato-platform`:
- `strato/core/blockapps-data/src/Blockchain/Data/BlockHeader.hs` — header RLP
- `strato/core/strato-model/src/Blockchain/Strato/Model/Class.hs` — `blockHeaderHash`
- `strato/core/strato-model/src/Blockchain/Blockstanbul/Model/Authentication.hs` — scrubs and seal payloads
- `strato/core/strato-model/src/Blockchain/Strato/Model/Secp256k1.hs` — `Signature` wire format
- `strato/core/strato-model/src/Blockchain/Strato/Model/Validator.hs` — `Validator` wire format
- `strato/core/blockapps-data/src/Blockchain/Verification.hs` — current (broken) receipts root
- `strato/core/blockapps-datadefs/src/Blockchain/Data/DataDefs.txt` — `EventDB` schema
- `strato/core/vm-tools/src/Blockchain/Bagger.hs` — block builder

---

## 1. Trust model and threat scope

A single trust assumption: at every block height, ≥⅔ of the validators authorized for that block are honest. Identical to STRATO's own consensus assumption.

Out of scope: any additional trust in bridge operators, oracles, header relayers, or admin keys. The admin multisig retains gating power for large withdrawals but cannot release funds without a valid proof; a fully compromised multisig is inert.

---

## 2. Canonical block header hash

Only `BlockHeaderV2` is in use. The canonical hash is what validators sign and what the on-chain light client computes.

```
blockHash = keccak256(rlp(scrubCommitmentSeals(header)))
```

`scrubCommitmentSeals` sets the `signatures` field to `[]`. **`proposalSignature` is retained.** No other fields change.

### 2.1 RLP layout (BlockHeaderV2)

Per `BlockHeader.hs:219-235`:

```
RLP(header) = RLPArray [
  rlp(2 :: Integer),            // version, always 2
  rlp(parentHash),              // 32 bytes
  rlp(stateRoot),               // 32 bytes
  rlp(transactionsRoot),        // 32 bytes
  rlp(receiptsRoot),            // 32 bytes
  rlp(logsBloom),               // bytes (currently 32 bytes of zeros; see §6.1)
  rlp(number),                  // big-endian integer
  rlp(timestamp),               // big-endian POSIX seconds (Integer)
  rlp(extraData),               // bytes (32-byte preamble + optional payload)
  rlp(currentValidators),       // RLPArray of Validator
  rlp(newValidators),           // RLPArray of Validator
  rlp(removedValidators),       // RLPArray of Validator
  rlp(proposalSignature),       // Maybe Signature (see §3.3)
  rlp(signatures)               // RLPArray of Signature; **EMPTY for hash purposes**
]
```

When the light client receives a header for verification, the input is this RLP with `signatures = []`, accompanied separately by the original signature list.

---

## 3. Wire formats

### 3.1 `Validator`

`Validator` is `newtype Validator = Validator Address` with derived `RLPSerializable`. So:

```
rlp(Validator) = rlp(Address) = 20-byte string ⇒ 0x94 || 20 bytes
```

A validator list is an RLP list of these 21-byte items.

### 3.2 `Signature`

Per `Secp256k1.hs:203-211`:

```
rlp(Signature) = RLPString of (R || S || V)   // 65 bytes total
```

- `R` — 32 bytes, big-endian
- `S` — 32 bytes, big-endian
- `V` — 1 byte, value `0` or `1`

The "R/S swap" comment in `Secp256k1.hs:236-255` is internal to the Haskell wrapper around `secp256k1-haskell`. Wire bytes are conventional `R || S || V`.

For Solidity `ecrecover`: pass `v + 27` as `v`, `R` as `r`, `S` as `s`.

### 3.3 `Maybe Signature` (for `proposalSignature`)

Per `RLP.hs:308-318`:

```
Nothing       → RLPString ""    (RLP byte: 0x80)
Just sig      → RLPArray [rlp(sig)]
```

For a present `Just sig`, this is a 1-element list wrapping the 65-byte signature string. Outer RLP is `0xc7 || 0xb8 0x41 || R || S || V`.

---

## 4. Validator commit signatures

Per `Authentication.hs:142-149`:

```
commitMessage = keccak256(blockHash || 0x02)
```

Each entry in the header's `signatures` list signs `commitMessage` independently. Signatures are produced and verified with no aggregation. The `0x02` byte is the IBFT domain separator for commit messages (vs. `proposalMessage` which uses a different scrub and no domain byte).

### 4.1 Quorum rule

Let `N = |currentValidators|`. A header is committed iff at least `ceil(2 * N / 3) + 1 = floor(2N/3) + 1` distinct validator addresses can be `ecrecover`'d from `signatures` against `commitMessage` and each is in `currentValidators`.

(Per `EventLoop.hs:362,380`: `3 * sameVoteCount > 2 * total` — the strict-greater check yields the same `floor(2N/3)+1` quorum.)

The light client MUST count distinct addresses, not just signature length, to prevent a single validator's signature from being submitted multiple times.

### 4.2 Proposer signature

`proposalSignature` is not verified by the light client. Its presence in `proposalMessage` is irrelevant because the commit-signature quorum already includes the proposer. Including it in the hashed payload (per §2) is the only thing that matters.

---

## 5. Validator-set transitions

Per `EventLoop.hs:179-184` and `Bagger.hs:619-628`:

- `currentValidators` in header `N` is the set authorized to sign block `N`.
- `newValidators` and `removedValidators` in header `N` take effect for block `N+1`. Specifically, the next block's `currentValidators` is `(currentValidators ∪ newValidators) \ removedValidators`.

### 5.1 Light client skipping rule

State: `tip` (highest block accepted), `validatorSet` (current set), `validatorCount`.

To accept a header `H`:
1. RLP-decode `H` (must be V2; reject otherwise).
2. Require `H.number > tip`.
3. Require the address-set commitment of `H.currentValidators` equals the on-chain `validatorSet` commitment. **This is the skip-safety check.** Encoding: `keccak256(abi.encodePacked(sortedAddresses))`. Reject if mismatch — caller must submit intermediate validator-set-changing headers in order.
4. Compute `blockHash` per §2.
5. Compute `commitMessage` per §4.
6. Recover and dedupe addresses from `H.signatures`; require quorum (§4.1).
7. Store `receiptsRoot` indexed by `H.number`.
8. Apply diff: `validatorSet := (validatorSet ∪ H.newValidators) \ H.removedValidators`. Update commitment and count.
9. Set `tip := H.number`.

Rationale: step 3 is what forces the submitter to walk through every validator-changing header. A caller cannot skip a rotation because the commitment in the next header reflects the new set, which won't match what the light client tracks.

Trust nuance: this assumes ⅔ of *every historical validator set* was honest at the moment it was active. A validator voted out who later goes rogue is harmless (their key isn't in `validatorSet`). A coalition of currently-rotated-out validators colluding *while still in the active set* is the same attack as a current-set compromise — same trust assumption as STRATO consensus.

---

## 6. Receipts trie

**This is a STRATO-core change.** Today, `receiptsRoot = MP.emptyTriePtr` for every block (`Verification.hs:31-32`). The bridge security argument has nothing to verify against until this is fixed.

### 6.1 Trie structure

Standard Ethereum-style Merkle Patricia Trie:

- **Key**: `rlp(txIndex)` where `txIndex` is the 0-based position of the transaction in the block.
- **Value**: `rlp(Receipt)` — see §6.2.
- **Root**: stored in `header.receiptsRoot` (32 bytes, replacing the current empty-trie sentinel).

Solidity verifies inclusion using a stock MPT verifier (e.g., Polygon's `MerklePatriciaProof` or equivalent).

### 6.2 Receipt RLP

```
rlp(Receipt) = RLPArray [
  rlp(status),          // 1 = success, 0 = revert; matches Ethereum convention
  rlp(gasUsed),         // cumulative gas used through this tx
  rlp(logs)             // RLPArray of Log
]
```

`logsBloom` is intentionally omitted: the bridge does not use bloom filters, and SolidVM events do not have indexed topics in the EVM sense. The header's `logsBloom` field stays 32 bytes of zeros for now.

### 6.3 Log RLP — SolidVM-flavored

SolidVM events do not use the EVM `(address, topics[], data)` layout. Per `DataDefs.txt:149-154`, the in-VM event record is `(blockHash, contractAddress, name :: String, args :: [String])`. We canonicalize this for the trie as:

```
rlp(Log) = RLPArray [
  rlp(contractAddress),   // 20-byte address
  rlp(eventName),         // RLP string (UTF-8 bytes of the event name)
  rlp(args)               // RLPArray of typed argument
]
```

Each `arg` in the `args` list is RLP-encoded **by Solidity type**, not as a free-form string:

| SolidVM type    | RLP encoding                                                |
|-----------------|-------------------------------------------------------------|
| `address`       | 20-byte string (`0x94 || 20 bytes`)                         |
| `uint256`/`int` | RLP integer: minimal big-endian (no leading zeros)          |
| `bool`          | RLP integer 0 or 1                                          |
| `string`/`bytes`| RLP string (raw bytes)                                      |
| arrays/structs  | nested RLP list of the same encoding rules recursively      |

This decouples *what is hashed* (typed RLP) from *what is displayed* (the existing `EventDB.args :: [String]` form returned by RPC). The two stay in sync via a deterministic encode/decode pair on the STRATO side. RPC continues to return the human-readable string form; the trie holds the typed canonical form.

Rationale for typed-not-string: parsing decimal-string ints and `0x`-prefixed addresses inside Solidity is awkward, gas-costly, and a source of bugs (leading-zero ambiguity, case folding, prefix handling). Typed RLP gives us byte-for-byte determinism with one-instruction decoders for each primitive.

---

## 7. Bridge-specific event schema

The flow is tiered at the source: small withdrawals are burn-on-request and trustlessly redeemable on Ethereum; large withdrawals are escrow-on-request, gated by Ethereum admin approval, and refundable on STRATO if rejected. Two distinct events drive two distinct Ethereum handlers — there is no event-type ambiguity.

### 7.1 Events

Both events are emitted from `mercata/contracts/concrete/Bridge/MercataBridge.sol`, replacing the existing `WithdrawalRequested` event (line 92).

**Small withdrawals** (amount < threshold) — burn-on-request:

```solidity
event Withdrawal(
  uint256 nonce,                // == withdrawalCounter, monotonic per-bridge
  uint256 externalChainId,
  address externalToken,
  address externalRecipient,
  uint256 externalTokenAmount,
  address stratoSender,
  address stratoToken,
  uint256 stratoTokenAmount
);
```

**Large withdrawals** (amount ≥ threshold) — escrow-on-request:

```solidity
event WithdrawalRequested(
  uint256 nonce,                // == withdrawalCounter, monotonic per-bridge
  uint256 externalChainId,
  address externalToken,
  address externalRecipient,
  uint256 externalTokenAmount,
  address stratoSender,
  address stratoToken,
  uint256 stratoTokenAmount
);
```

The two events have identical fields. Distinct names is the dispatch mechanism — Ethereum's vault treats them as separate entry points with different gating.

In SolidVM event form for both:
- `name = "Withdrawal"` or `"WithdrawalRequested"`
- `contractAddress = <MercataBridge address>`
- `args` (typed RLP, order matches the field order above)

### 7.2 Threshold

The threshold lives in `MercataBridge.sol` as `mapping(uint256 => mapping(address => uint256)) instantThreshold` keyed by `(externalChainId, externalToken)`. STRATO compares against it at request time to decide which event to emit. The Ethereum vault keeps an identical mapping that it consults when verifying a claim — a `Withdrawal` proof for an amount above Ethereum's threshold is rejected, and likewise for `WithdrawalRequested` below threshold. Mismatches between the two configurations are an operational issue, not a fund-loss risk: the Ethereum vault's threshold is authoritative for what it will release.

Governance keeps both in sync. Off-chain monitoring should alert on divergence.

### 7.3 Replay nonce

On the Ethereum side:

```
nonce = keccak256(abi.encodePacked(stratoBlockNumber, txIndex, logIndex))
```

Not the application-level `withdrawalCounter` (which is useful for indexing but not cryptographically unique under replay). Out-of-order and third-party claim submission work without sequential consumption.

Ethereum vault state: `mapping(bytes32 => uint8) nonceState` where `0 = unused, 1 = claimed, 2 = rejected, 3 = approved-pending-execution`. State machine on Ethereum:
- `unused → claimed` on small-withdrawal proof submission (auto-releases funds).
- `unused → approved-pending-execution` on large-withdrawal admin approval (after proof was already verified).
- `unused → rejected` on large-withdrawal admin rejection.
- `approved-pending-execution → claimed` on user calling `executeApproved(nonce)`.
- `claimed`, `rejected`, `approved-pending-execution` are all terminal w.r.t. fresh approve/reject/claim attempts.

STRATO bridge mirrors a smaller state machine for escrow refunds: `mapping(uint256 => uint8) escrowState` where `0 = none, 1 = escrowed, 2 = refunded`. `refundEscrow` requires `escrowed` and transitions to `refunded`.

### 7.4 Rejection / refund flow for large withdrawals

The full lifecycle for a large withdrawal:

1. User calls `requestWithdrawal(...)` on STRATO. Bridge validates, **escrows** (locks) tokens, increments counter, emits `WithdrawalRequested(nonce, ...)`. `escrowState[nonce] = escrowed`.
2. STRATO block finalizes; proof relayer posts header to `STRATOLightClient` on Ethereum.
3. User (or service) calls `submitProof(blockNumber, txIndex, logIndex, mptProof, eventData)` on Ethereum vault. Vault verifies proof, marks the corresponding `nonce` as eligible for admin review, emits `WithdrawalAwaitingApproval(nonce)`.
4. Ethereum admin reviews. Two outcomes:
    - **Approve:** admin quorum calls `approveWithdrawal(nonce)` → vault releases external tokens to recipient, sets `nonceState[nonce] = claimed`, emits `WithdrawalApproved(nonce)`.
    - **Reject:** admin quorum calls `rejectWithdrawal(nonce)` → vault sets `nonceState[nonce] = rejected`, emits `WithdrawalRejected(nonce)`. No tokens move.
5. On rejection: STRATO admin observes `WithdrawalRejected(nonce)` off-chain and calls `refundEscrow(nonce, stratoSender, stratoToken, stratoTokenAmount)` on the STRATO bridge. Bridge checks `escrowState[nonce] == escrowed`, validates the args match the original escrow record, transfers the locked tokens back to `stratoSender`, sets `escrowState[nonce] = refunded`, emits `EscrowRefunded(nonce)`.

#### 7.4.1 User-initiated escrow abort (admin-inaction timeout)

If neither approve nor reject is mined on Ethereum within `WITHDRAWAL_ABORT_DELAY` (default 48h, mirroring `MercataBridge.sol:160`), the user may call `userAbortEscrow(nonce)` on STRATO to refund their own escrow without admin involvement. This requires that no Ethereum-side terminal state has been reached for the nonce — but STRATO can't directly verify Ethereum state. Practical resolution: the admin must call `rejectWithdrawal` on Ethereum *before* `WITHDRAWAL_ABORT_DELAY` elapses if they intend to block refund; otherwise users can self-recover. Same trust model as the existing 48h pattern in the legacy bridge.

#### 7.4.2 Trust analysis

| Compromised principal | Worst case |
|---|---|
| Ethereum admin only | DoS-reject large withdrawals. Cannot drain. |
| STRATO admin only | DoS-refund pending escrows. Cannot drain (refund returns previously-escrowed funds only). |
| Both admins | Coordinated DoS. Cannot drain. |
| Admins + ⅔ STRATO validators | Can drain. Same as compromising STRATO consensus itself. |

The cryptographic proof requirement on Ethereum is what makes any admin compromise non-fatal. `refundEscrow` adds a liveness path, not a trust dependency for fund safety.

#### 7.4.3 Race: late approval after refund

Sequencing prevents the "Ethereum admin approves *after* STRATO admin already refunded" race:

- `nonceState` on Ethereum is a state machine (§7.3). Once `rejectWithdrawal(nonce)` is mined, `nonceState[nonce] = rejected` and `approveWithdrawal` reverts.
- `refundEscrow` on STRATO must only be called *after* `rejectWithdrawal` is mined and finalized on Ethereum. Operational rule for the STRATO admin; eventually enforced cryptographically by the reverse-proof system (§10).

A misbehaving STRATO admin who calls `refundEscrow` before Ethereum has reached terminal rejection cannot cause double-spend: even if Ethereum subsequently approves, the user has already received their refund on STRATO and the `approveWithdrawal` payout would compensate them twice. This is harmful to the protocol but: (a) requires STRATO-admin compromise, (b) requires Ethereum-admin to also act, and (c) is detectable from chain state. Phase 5 rollout should set a procedural rule that STRATO admins wait for `WITHDRAWAL_ABORT_DELAY + buffer` post-rejection-finality before refunding.

### 7.5 Bridge contract changes (preview, not Phase 0 work)

- Existing `INITIATED → PENDING_REVIEW → COMPLETED` state machine for withdrawals is replaced by the two-tier flow above.
- `requestWithdrawal` becomes the dispatch point — burn or escrow based on threshold, emit corresponding event.
- `confirmWithdrawal` and `finaliseWithdrawal` are removed (their job moves to Ethereum, gated by proof).
- `abortWithdrawal` is replaced by `userAbortEscrow` (semantically similar, only for escrow tier).
- New: `refundEscrow(nonce, ...)` admin-only.
- New: `EscrowRefunded(nonce)` event.
- `useHotWallet` flag removed: the tier is determined at request time and signaled via the event type.

Detailed contract diff is Phase 3 work.

---

## 8. Light-client interface (preview, not Phase 0 work)

Three contract entry points the spec presumes; full design in Phase 2:

```solidity
interface IStratoLightClient {
  function submitHeader(bytes calldata headerRLP, bytes[] calldata signatures) external;
  function getReceiptsRoot(uint256 blockNumber) external view returns (bytes32);
  function tip() external view returns (uint256);
}
```

`headerRLP` is the V2 header with `signatures = []`; `signatures[]` is the original commit-signature list.

---

## 9. STRATO RPC additions (preview, Phase 1 work)

Two new endpoints:

- `strato_getFinalizedHeader(blockNumber)` → `{ headerRLP: hex, signatures: [hex] }`
  - `headerRLP` includes the `proposalSignature` and excludes the `signatures` field (or includes it as `[]`); see §2 — must be exactly the bytes hashed by validators.
  - `signatures` is the list of 65-byte `R||S||V` blobs.
- `strato_getReceiptProof(blockNumber, txIndex)` → `{ headerRLP: hex, signatures: [hex], receiptRLP: hex, mptProof: [hex] }`
  - `receiptRLP` is the full receipt for tx `txIndex`.
  - `mptProof` is the standard list of MPT node bytes from leaf to root.

The user (or proof-generator service) feeds these directly into `submitHeader` and `claimWithdrawal`.

---

## 10. Open items punted from Phase 0

These are deferred but flagged so they aren't forgotten:

1. **Header posting cadence** — checkpoint interval, who runs the relayer, gas budget. Phase 4.
2. **Deposit-direction proofs (Ethereum → STRATO)** — symmetric problem, separate design conversation. Likely an attestor-committee model since STRATO is permissioned. **Once this exists, `refundEscrow` (§7.4) gets its admin gate replaced with a proof-of-`WithdrawalRejected` check, fully eliminating the STRATO-admin DoS-refund vector.** Same function signature, different gate.
3. **Validator-set commitment encoding for the on-chain side** — `keccak256(abi.encodePacked(sortedAddresses))` is proposed in §5.1 but Phase 2 will lock the exact bytes (sorted by what? leading zero handling?).
4. **Genesis bootstrap of the light client** — first validator set installed at deploy time; rotation-safe procedure for redeploys. Phase 2.
5. **Cutover plan for in-flight legacy withdrawals** — Phase 3.
6. **Threshold-mismatch detection** — relayer-side monitor that compares STRATO's `instantThreshold` mapping against Ethereum vault's mapping and alerts on divergence. Phase 4.
7. **Audit scope and timing** — Phase 5.

---

## 11. Decisions locked by this doc

- ECDSA stays. No BLS migration. (14 validators, ~30K gas per header update, BLS payback only at >50 validators.)
- Block hash payload: `rlp(header_with_signatures_emptied)`, including `proposalSignature`.
- Commit signature payload: `keccak256(blockHash || 0x02)`.
- Light client uses skipping verification, gated by `validatorSet` commitment match in each accepted header.
- Receipts trie: standard Ethereum MPT, key = `rlp(txIndex)`, value = `rlp(Receipt)`, root in `header.receiptsRoot`.
- Receipt RLP: `[status, gasUsed, logs]`, no `logsBloom` field.
- Log RLP: `[contractAddress, eventName, typedArgs]` — SolidVM-shaped, typed canonical encoding.
- Withdrawal flow is tiered at the source: small = burn-on-request (`Withdrawal` event), large = escrow-on-request (`WithdrawalRequested` event).
- Replay nonce: `keccak256(blockNumber, txIndex, logIndex)`. State grows per claim only; no expiry.
- Rejection refund mechanism: STRATO-admin-attested `refundEscrow(nonce)` for the interim; replaced by proof-of-rejection from the deposit-direction system in a future phase.
