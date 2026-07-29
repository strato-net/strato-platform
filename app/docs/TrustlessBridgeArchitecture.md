# Building a Trustless Cross-Chain Bridge: How We Connect STRATO to Ethereum, Base, and Linea

Bridges are the most-attacked piece of crypto infrastructure. Of the all-time top ten DeFi exploits by value lost, six were bridge hacks. The common thread in nearly every case is the same: somewhere in the system, a small set of relayers (often a multisig) decides what counts as a valid cross-chain message. If that group is compromised — by a private key leak, a UI phish, a contract bug, a regulator's request — funds drain.

We wanted a bridge between [STRATO](https://strato.nexus) and the major public EVM chains that doesn't depend on a relayer's honesty. Every cross-chain message should be cryptographically verifiable by both ends, with no human in the validity loop. This post walks through how we built that — covering bridge-in (external chain → STRATO) and bridge-out (STRATO → external chain) for Ethereum mainnet, Base, and Linea.

The reader is assumed to be comfortable with EVM basics, Merkle-Patricia tries, RLP encoding, and the rough shape of an L2 rollup. The details get specific, but the underlying mental model — "each chain runs a light client of the other" — is simple.

## The fundamental trick: symmetric light clients

A trustless bridge needs two things, in both directions:

1. A way for chain A to know that a specific event happened on chain B.
2. A way to make that proof cheap enough to verify on-chain in a single transaction.

A **light client** does exactly this. It runs entirely inside a smart contract on chain A, and it tracks the consensus of chain B — typically just the canonical block headers, plus whatever signatures or proofs are needed to authenticate them. Once an external block header is anchored in a light client, anyone can prove that any specific transaction or event happened in that block using a [Merkle-Patricia trie](https://ethereum.org/en/developers/docs/data-structures-and-encoding/patricia-merkle-trie/) proof — the same machinery the EVM already uses internally for receipt tries.

So our bridge stack has two light clients:

```
  ┌─────────────────────────┐                      ┌──────────────────────────┐
  │       STRATO node       │                      │   External chain (Eth/   │
  │                         │                      │   Base / Linea)          │
  │  ┌───────────────────┐  │                      │                          │
  │  │  EthLightClient   │  │  ◄──── tracks ◄────  |                          │
  │  │  (+ BaseLightCli- │  │                      │                          │
  │  │   ent, LineaLight │  │                      │                          │
  │  │   Client wrappers)│  │                      │                          │
  │  └───────────────────┘  │                      │  ┌────────────────────┐  │
  │                         │                      │  │ STRATOLightClient  │  │
  │  ┌───────────────────┐  │                      │  │ (validator-signed  │  │
  │  │   MercataBridge   │  │                      │  │  headers)          │  │
  │  │   (mint / burn)   │  │                      │  └────────────────────┘  │
  │  └───────────────────┘  │                      │                          │
  │                         │                      │  ┌────────────────────┐  │
  │                         │  ────► tracks ────►  |  |                    │  |
  │                         │                      │  │   BridgeVault      │  │
  │                         │                      │  │   (escrow funds)   │  │
  │                         │                      │  └────────────────────┘  │
  └─────────────────────────┘                      └──────────────────────────┘
```

Bridge-in (external → STRATO) uses the **EthLightClient** on STRATO to verify external chain receipts. Bridge-out (STRATO → external) uses the **STRATOLightClient** on the external chain to verify STRATO receipts. Both directions reduce to: "anchor a header, then prove the event with an MPT proof against that header's receipts root."

The interesting engineering is in how each chain's headers actually get anchored — that's where the consensus mechanism of the source chain leaks into the contract code.

---

## Part 1: Bridge-in. EthLightClient — the foundation

To bridge in from Ethereum, STRATO needs to verify that a `DepositRouted` event was emitted on Ethereum mainnet. The verification splits cleanly into two halves:

1. Did Ethereum produce a finalized block whose receipts root is X?
2. Does the user's transaction's receipt sit at slot (txIndex, logIndex) in the trie rooted at X?

(2) is a standard MPT inclusion proof — boring, well-understood, ~150 lines of Solidity. (1) is the hard part: we need to verify Ethereum's consensus without re-running Ethereum.

### The post-Altair miracle

Ethereum's beacon chain ships with a [light client protocol](https://github.com/ethereum/consensus-specs/blob/dev/specs/altair/light-client/sync-protocol.md) built in. Every 32-slot epoch, the active **sync committee** — a rotating set of 512 validators — collectively signs a `LightClientFinalityUpdate` message that attests to the latest finalized beacon header.

A finalized beacon header carries an execution payload (the EL block), which in turn carries the EL block's receipts root. So if we trust the sync committee's BLS aggregate signature, we trust the receipts root.

The crucial property: the sync committee membership for period N is fully determined by the chain's state at the start of period N-1, and that membership is committed inside a previous beacon block. So we can bootstrap once at deploy time with the live committee, then **roll the committee forward** as new periods arrive — each rollover is itself verified by the previous period's committee.

`EthLightClient.sol` implements this. The contract holds:

- `committeePubkeys[period]` — 512 × 48-byte compressed BLS-G1 pubkeys per period.
- `anchored[blockNumber]` — `{ receiptsRoot, stateRoot }` for every block we've verified.

Two main entry points:

```solidity
// Roll the committee forward.
function advanceCommittee(PeriodTransitionInput memory t) external;

// Anchor a specific EL block by proving it sits inside a beacon-finalized
// header, signed by the appropriate period's committee.
function anchorBlockHeaderViaBlockRoots(...) external;
function anchorBlockHeaderViaHistoricalSummaries(...) external;
```

### Anchoring via state proofs

We started with a parent-chain walk (anchor the freshly finalized header, then chain back through `parentHash` pointers to the user's deposit block). It worked but was O(N) in deposit age and quadratic on-chain because each historical header needed its own `hashTreeRootBeaconHeader` computation.

The replacement is much cleaner: use the beacon state's existing self-referencing Merkle structures.

The beacon state has two fields that index historical blocks:

- `state.block_roots` — `Vector[Root, 8192]`. A rolling buffer of the most recent 8192 beacon block roots, indexed by `slot % 8192`. Lets us look up any block from the last ~27 hours.
- `state.historical_summaries` — `List[HistoricalSummary]`. After each 8192-slot accumulator period, the previous `block_roots` vector's hash tree root is appended here. Lets us look up any block since Capella (~years of history).

So instead of walking parents, we:

1. Take the *attested* beacon header from the latest LightClientFinalityUpdate (the one the sync committee just signed). Its state root is `attestedStateRoot`.
2. From the beacon node, fetch a Merkle proof for `state.block_roots[depositSlot % 8192]` (or `state.historical_summaries[i]` for older deposits) within `attestedStateRoot`. The leaf is the beacon block root of the deposit slot.
3. From the beacon block at that root, prove the execution payload's `receiptsRoot` and `blockNumber` via a smaller Merkle proof.

The whole thing collapses to one big batched proof:

```
   attestedStateRoot
         │
         ├─ (Merkle proof, depth 19 for block_roots, 45 for historical)
         │
         ▼
   beaconBlockRoot @ depositSlot
         │
         ├─ (Merkle proof through BeaconBlockBody → ExecutionPayload)
         │
         ▼
   { receiptsRoot, blockNumber }
```

The proof for block_roots is `(blockRootsContainerGindex << 13) | (slot % 8192)` generalized indices deep — about 19 hashes total. The contract verifies each step with `keccak256` and `sha256` (sha256 specifically because SSZ uses sha256, while everything else in the EVM stack is keccak — easy to get wrong).

Now once `anchored[blockNumber].receiptsRoot != 0`, we have everything we need to verify a deposit.

---

## Part 2: Bridge-in flavor 1 — Ethereum (the direct case)

For deposits originating on Ethereum mainnet (or Sepolia), the chain we're anchoring *is* the chain the EthLightClient tracks. So bridge-in becomes:

```
   user calls EthBridgeIn.claim(blockNumber, txIndex, logIndex,
                                mptProof, receiptValueBytes, ...)
   │
   ▼
   receiptsRoot = EthLightClient.getReceiptsRoot(blockNumber)
   require(receiptsRoot != 0)
   │
   ▼
   key = rlp(txIndex)
   require(MPTProof.verifyInclusion(receiptsRoot, key,
                                    receiptValueBytes, mptProof))
   │
   ▼
   strip EIP-2718 envelope, decode receipt
   find DepositRouted log at logIndex
   require(log.address == depositRouter)
   require(log.topics[0] == depositRoutedSig)
   │
   ▼
   decode (token, amount, sender, stratoAddress, ...) from log
   mint(stratoAddress, amount)
```

The user's frontend builds the bundle off-chain by:

1. Calling `eth_getBlockReceipts(blockNumber)` on Ethereum.
2. Reconstructing the receipts MPT in-memory (we use `@ethereumjs/trie`).
3. Generating the proof for `rlp(txIndex)`.

The reconstruction step is byte-sensitive — typed receipts (EIP-2718) carry a leading type byte, legacy ones don't, and getting that wrong means your computed root won't match the chain's. The decoder handles 0x00..0x7f (typed envelope) and 0xc0..0xff (RLP list) correctly.

Note: the user submits this themselves. No relayer is involved. The backend assembles the proof bundle, but it's pure data — there's no signature, no trust, and the user (or anyone) can independently rebuild and verify the same bundle.

---

## Part 3: Bridge-in flavor 2 — Base (composition with dispute games)

Base is an [OP-Stack](https://stack.optimism.io) rollup. It doesn't have its own consensus you can run a light client of (a Base block is, at its core, "what the Base sequencer says it is"). What it *does* have is **L1 finality via dispute games**: every few minutes, an off-chain proposer submits a `DisputeGameCreated` event to the L1 DisputeGameFactory contract, attesting to an output root for a specific L2 block. The output root binds the L2 state.

So the trick: compose. Anchor an L1 block on EthLightClient. Use that L1 receipts root to verify a `DisputeGameCreated` event. Use the event's `rootClaim` to authenticate an L2 block header. Use the L2 header's receipts root to verify the user's deposit receipt.

### The output root preimage

OP-Stack defines:

```
outputRoot = keccak256(
  bytes1(0x00)              || // version byte
  l2StateRoot               || // from L2 block header
  withdrawalStorageRoot     || // storage root of L2ToL1MessagePasser
                               // predeploy at 0x4200000000000000000000000000000000000016
  l2BlockHash               // keccak(rlp(l2HeaderRLP))
)
```

The proposer submits this single 32-byte hash as `rootClaim` in the DGC event. To verify it on STRATO, we need three things the proposer didn't include:

- `l2StateRoot` — pluck from the L2 header.
- `withdrawalStorageRoot` — pluck from `eth_getProof(0x4200...0016, [], anchorBlock)`.
- `l2BlockHash` — compute by re-hashing the L2 header RLP.

If `keccak(0x00 || stateRoot || wsRoot || keccak(rlp(header))) == rootClaim`, we've authenticated the L2 header. From there it's the same machinery as Ethereum: take `header.receiptsRoot`, verify the deposit's receipt MPT proof against it.

```
   ┌─────────────────────────────────────────────────────────────┐
   │ L1 (Ethereum)                                               │
   │                                                             │
   │  EthLightClient.receiptsRoot[L1_BLOCK] ──┐                  │
   │                                          │                  │
   │  ┌─────────────────────────────┐         │                  │
   │  │ DisputeGameFactory          │         │ MPT proof        │
   │  │   emits DisputeGameCreated  │  ───────┤ (receipt trie)   │
   │  │   topics[3] = rootClaim     │         │                  │
   │  └─────────────────────────────┘         ▼                  │
   │                                       rootClaim ────────┐   │
   └─────────────────────────────────────────────────────────│───┘
                                                             │
   ┌─────────────────────────────────────────────────────────│───┐
   │ L2 (Base)                                               │   │
   │                                                         │   │
   │  L2 header @ anchorBlockNumber  ────────────────────┐   │   │
   │  L2ToL1MessagePasser predeploy   ──┐                │   │   │
   │  (storage root via eth_getProof)   │                │   │   │
   │                                    │                │   │   │
   │     compute: keccak(0x00 ||        │                │   │   │
   │     stateRoot || wsRoot ||       ──┴──► outputRoot' ┘   │   │
   │     blockHash)                          │               │   │
   │                                         │               │   │
   │                                         ▼               │   │
   │                              outputRoot' == rootClaim ◄─┘   │
   │                                                             │
   │  ...header.receiptsRoot is now trusted...                   │
   │  ...verify deposit receipt MPT proof against it.            │
   └─────────────────────────────────────────────────────────────┘
```

### Reaching back to the user's actual block

There's one wrinkle. Proposers post DGCs on their own cadence — every ~few minutes on Base mainnet, every few hours on Sepolia. So for an arbitrary user deposit at L2 block `N`, the most recent covering DGC likely names some `N_anchor ≥ N`, possibly hundreds of blocks ahead.

Solution: **parent-chain walk**. After anchoring `N_anchor` via the rootClaim path, the user submits `parentChain[]` — a list of every L2 header from `N_anchor.parent` back to `N`. The contract verifies each link by checking `keccak(parentRLP) == previousChild.parentHash` and `parent.number == previous.number - 1`. Each verified parent gets its own `anchored[blockNumber] = receiptsRoot` entry.

The walk is byte-cheap (no signature verification), so the cap is purely "how many keccaks fit in one tx." We picked 256 for Base — a deposit can sit unclaimed for ~9 minutes of L2 wall-clock before becoming unreachable, but in practice dispute games anchor more often than that.

### Trust posture

There's an important nuance. A `DisputeGameCreated` log fires the *moment* a proposer submits — before the game resolves. If the proposer lies and submits a wrong rootClaim, the dispute window (3.5 days on mainnet) lets anyone challenge and slash them. But during that window, the claim is unresolved.

We accept unresolved claims, because:

1. The off-chain backend cross-checks the proposer's rootClaim against the actual L2 output it computes from current Base RPC state. We only emit the proof bundle if they match. So even though the contract trusts any DGC, the bundle a real user receives wraps an honest claim.

2. Base's proposer set is permissioned (Coinbase / the Base team). For mainnet today this is the same trust posture as the proposer themselves.

A future hardening — already designed but not deployed — adds a storage proof of `game.status() == DEFENDER_WINS` to the on-chain verifier. That pushes wait time to ~7 days but removes the proposer trust assumption. For now, the cross-check at proof-generation time is enough.

---

## Part 4: Bridge-in flavor 3 — Linea (composition with zk finalization)

Linea is a zkEVM. Its finality model is fundamentally different from OP-Stack: instead of a fault-proof game with a long challenge window, the aggregator submits a SNARK proof to the L1 LineaRollup contract that proves a state transition is valid. Once the proof verifies, the L2 state is canonical — no challenge period, no proposer trust.

This makes the proof composition *easier* than Cannon, because the L1 event carries the state root directly. No outputRoot preimage to reconstruct, no `withdrawalStorageRoot` to fetch.

### The DataFinalizedV3 event

The relevant L1 event:

```solidity
event DataFinalizedV3(
    uint256 indexed startBlockNumber,
    uint256 indexed endBlockNumber,
    bytes32 indexed shnarf,           // "shaped nonce-augmented rolling finalized" — internal
    bytes32 parentStateRootHash,
    bytes32 finalStateRootHash
);
```

Each finalization commits an L2 block *range* `[startBlock, endBlock]` and the L2 state root at `endBlock`. Anchoring an arbitrary deposit block `N` becomes:

1. Anchor the L1 block where the most recent covering `DataFinalizedV3` (with `endBlock >= N`) fired.
2. Verify the L1 receipt-MPT proof for that event.
3. Decode `endBlockNumber` from topic[2] and `finalStateRoot` from data[32:64].
4. Take the L2 header for `endBlock`, require `header.number == endBlockNumber && header.stateRoot == finalStateRoot`.
5. Parent-walk from `endBlock - 1` back to `N`.
6. Verify deposit receipt MPT against `header[N].receiptsRoot`.

```
   ┌──────────────────────────────────────────────────────────────┐
   │ L1 (Ethereum)                                                │
   │                                                              │
   │  EthLightClient.receiptsRoot[L1_BLOCK]                       │
   │                                                              │
   │  ┌─────────────────────────────┐                             │
   │  │ LineaRollup                 │                             │
   │  │   emits DataFinalizedV3     │   verified by MPT proof     │
   │  │   topic[2] = endBlock       │                             │
   │  │   data[32:64] = finalState  │                             │
   │  └─────────────────────────────┘                             │
   │              │                                               │
   └──────────────│───────────────────────────────────────────────┘
                  │
   ┌──────────────│───────────────────────────────────────────────┐
   │ L2 (Linea)   ▼                                               │
   │                                                              │
   │  L2 header @ endBlock ──► require number == endBlock         │
   │                         require stateRoot == finalState      │
   │  ...                                                         │
   │  parent walk ──► L2 header @ N (user's deposit)              │
   │  ...verify deposit receipt MPT against header[N].rcptRoot    │
   └──────────────────────────────────────────────────────────────┘
```

### A subtlety: parent-walk reach vs. batch size

Linea finalizes batches of ~2500 L2 blocks roughly hourly. That's much larger than Base's per-DGC range. So the parent walk can be long — worst-case ~3000 blocks to walk from an `endBlock` to a deposit at the start of the same batch.

The contract's `MAX_PARENT_CHAIN_LEN = 3000` accommodates this. SolidVM (STRATO's Solidity dialect) handles loops of this size fine; we tested up to several thousand iterations without hitting any soft cap. The off-chain side ships ~120 KB of L2 header RLP per claim in the worst case — fine for a transaction payload.

### Why not an L1 storage proof?

The architecture *anticipated* using a different proof shape for Linea: anchor an L1 block, then prove an entry in the `stateRootHashes[blockNumber]` mapping via `eth_getProof`. That would have avoided the per-tx receipt MPT round trip.

When we actually probed `LineaRollup`'s storage layout against a real recent finalization, no such mapping existed at any reachable slot. LineaRollup V3 uses a shnarf-keyed `shnarfFinalized` flag mapping (boolean: "is this finalization committed?") but doesn't persist per-L2-block state roots directly — the state roots only live in the event log.

So the event-proof path is the only practical way. Functionally identical machinery to Base, just a different L1 event shape.

---

## Part 5: Bridge-out. STRATOLightClient on the external chain

Going the other direction (STRATO → external chain) requires the external chain to verify a STRATO event. STRATO's consensus algorithm is PBFT, which involves a set of authorized validators signing blocks. So the light client we deploy on Ethereum/Base/Linea is structurally simpler than the EthLightClient — it doesn't need to verify BLS aggregates over 512 sync-committee members, just ECDSA signatures from N known validators.

### The validator set and signed headers

`STRATOLightClient.sol` lives on each external chain. It holds:

- `validators` — the current validator set (rotated via a separate admin flow).
- `quorum` — the number of validator signatures required to accept a header (e.g., 2-of-3 for a small validator set).
- `headers[blockNumber]` — `{ receiptsRoot, stateRoot, parentHash }` for every header we've anchored.
- `tip` — the highest anchored block number.

Anyone can call `submitHeader(headerRLP, signatures[])`. The contract:

1. Recovers each ECDSA signer from `headerRLP` + signature.
2. Verifies that at least `quorum` of them are in `validators`.
3. Verifies hash-chain continuity: `keccak(parentHeaderRLP) == headerRLP.parentHash` for the previously anchored predecessor (or via accumulator if jumping ahead).
4. Stores `headerRLP.receiptsRoot` keyed by `headerRLP.number`.

Validator rotation happens via on-chain admin txs (not relevant to claim verification).

### The Withdrawal event

When a user wants to bridge funds out, they call `MercataBridge.requestWithdrawalProof(...)` on STRATO. Below threshold:

```solidity
event Withdrawal(
    uint256 nonce,
    uint256 externalChainId,
    address externalToken,
    address externalRecipient,
    uint256 externalTokenAmount,
    address stratoSender,
    address stratoToken,
    uint256 stratoTokenAmount,
    uint256 prevWithdrawalBlock,    // STRATO block of the previous Withdrawal
                                     // event for this chain (linked list)
    uint256 seq                      // Sequence number for sequenced release
);
```

STRATO burns the user's tokens immediately and emits this event. The user (or anyone) can now prove the event happened on STRATO and call `BridgeVault.claimWithdrawal(...)` on the external chain to release the underlying ERC-20 or ETH.

### claimWithdrawal (hot path, below threshold)

```solidity
function claimWithdrawal(
    uint256 blockNumber,
    uint256 txIndex,
    uint256 logIndex,
    bytes[] calldata mptProof,
    bytes calldata receiptRLP
) external;
```

The vault:

1. Pulls `receiptsRoot = STRATOLightClient.headers[blockNumber].receiptsRoot`. Reverts if 0.
2. Verifies `MPTProof.verifyInclusion(receiptsRoot, rlp(txIndex), receiptRLP, mptProof)`.
3. Decodes the receipt → finds the Withdrawal log at `logIndex` → decodes its args.
4. Checks `externalChainId == block.chainid` (this vault only claims its own chain's withdrawals).
5. Checks `externalTokenAmount < instantThreshold[externalToken]` — this gates whether the hot path is allowed.
6. Computes a unique `nonce = keccak256(chainId, blockNumber, txIndex, logIndex)` and refuses replay.

If all checks pass, the vault releases funds and advances `nextSeqToProcess` (more on that below).

### submitProof (cold path, above threshold)

Withdrawals above the threshold can't auto-release — the proof comes in via `submitProof`, which **queues** the withdrawal for admin approval rather than releasing immediately. The admin multisig calls `releaseProvenWithdrawal(nonce)` after off-chain compliance checks pass.

The receipt-proof machinery is identical; the threshold check is what decides which path applies. This is a pragmatic concession to regulated environments — for amounts large enough to matter, an off-chain hold is worth the latency.

### Sequencing: the linked list

There's a subtle problem with the hot path. Suppose the threshold is 1 ETH, and three users withdraw in quick succession: Alice 0.5, Bob 2.0, Charlie 0.5. STRATO emits:

- `Withdrawal(Alice, 0.5, seq=0)` ← hot path
- `WithdrawalRequestedV2(Bob, 2.0)` ← cold path (above threshold, no seq)
- `Withdrawal(Charlie, 0.5, seq=1)` ← hot path

Now the vault sees Alice's and Charlie's proofs but not Bob's (his is awaiting admin approval). If Charlie's seq=1 claim is submitted before Alice's seq=0, the vault has two options:

- Accept Charlie immediately, then later accept Alice. But then Bob's eventual release is *behind* both — meaning if there's a vault liquidity shortfall, Bob (the conservative compliance case) loses first.
- Enforce strict ordering: Alice (seq 0) must drain before Charlie (seq 1).

We chose the second. The vault tracks `nextSeqToProcess`. A claim with `seq == nextSeqToProcess` releases immediately and advances the cursor; a claim with `seq > nextSeqToProcess` gets queued in `queuedClaims[seq]`. Each subsequent release tries to drain queued seqs in order, capped at `MAX_DRAIN_PER_CLAIM = 16` to bound per-tx gas.

The `prevWithdrawalBlock` field in the event lets the off-chain UI walk back through the linked list of hot-path withdrawals and submit any missing predecessors. So if Charlie's UI sees `nextSeqToProcess = 0` on-chain but his proof says `seq = 1`, the UI:

1. Reads Charlie's `proof.prevWithdrawalBlock` → block 190.
2. Fetches the seq=0 proof from STRATO at block 190.
3. Anchors STRATO block 190's header on the vault's light client.
4. Submits seq=0 first (releasing Alice's funds).
5. Then submits Charlie's seq=1.

Both txs are batched into the same user wallet flow. The user signs both; the L1 vault releases both atomically with respect to vault state.

```
   STRATO blocks:    190        192        ...
   ┌──────────────┐  ┌────┐    ┌────┐
   │ Withdrawal   │  │seq │    │seq │
   │  Alice 0.5  ─┼──┤ 0  │◄───┤ 1  │
   │  prev = 0    │  │    │    │prev│
   └──────────────┘  └────┘    │=190│
                               └────┘
                                 │
                                 ▼
   UI walks: ownSeq=1 > nextSeq=0
             cursor = prev = 190
             fetch seq=0 @ block 190
             submit [seq=0, then seq=1]
                                 │
                                 ▼
   Vault:  releaseAlice, nextSeqToProcess=1
           releaseCharlie, nextSeqToProcess=2
```

### Why this beats a multisig

A relayer-based bridge would have a small set of keys signing approvals for each cross-chain message. If those keys are compromised — by a key leak, a phishing attack, a regulatory order — anyone holding the keys can move arbitrary funds.

In this design:

- The validator set on STRATOLightClient is the same set that secures STRATO itself. Compromising the bridge requires compromising the L1 chain.
- The sync committee on EthLightClient (and its derivatives) is the literal Ethereum sync committee. Compromising it requires compromising Ethereum's beacon chain consensus.
- The Base / Linea wrappers add no new trust — they compose with EthLightClient.
- The threshold + admin multisig on `submitProof` (cold path) is a compliance feature, not a security feature; below threshold, the multisig is bypassed entirely.

There's still some operational trust — the admin can update light client configs (validator set, threshold). But those updates are themselves on-chain transactions that can be audited and time-locked if you want.

---

## Part 6: Putting it together — a full claim trace

To make this concrete, here's what happens when a user bridges 0.01 ETH from Base mainnet to STRATO:

1. **User deposits on Base.** They call `DepositRouter.deposit{value: 0.01 ether}(stratoRecipient, stratoToken)` on Base. This emits `DepositRouted(token, amount, sender, stratoRecipient, stratoToken, nonce)` and locks the ETH in the router's vault.

2. **Wait for L1 anchoring (~few minutes).** A Base proposer submits `DisputeGameCreated(disputeProxy, gameType, rootClaim)` to the L1 DisputeGameFactory. `rootClaim` commits to the L2 output at some block ≥ the user's deposit block.

3. **User initiates claim on STRATO.** The frontend calls the backend's `/bridge/trustlessClaim` endpoint. The backend assembles:
   - An EthLightClient anchor for the L1 block via the latest beacon `LightClientFinalityUpdate` + state proof.
   - A BaseLightClient anchor: the L1 receipt MPT proof for the DGC event, the L2 anchor header, the L2 withdrawal storage root, and the L2 parent walk back to the deposit block.
   - An EthBridgeIn claim: the L2 receipt MPT proof for the user's `DepositRouted` event.

4. **User signs the batch on STRATO.** Three transactions in one signed batch:
   1. `EthLightClient.anchorBlockHeaderViaBlockRoots(...)` — verifies BLS aggregate + state proof, stores L1 receiptsRoot.
   2. `BaseLightClient.anchorBaseBlockChainViaCannon(...)` — verifies L1 receipt of DGC, reconstructs outputRoot from L2 header, walks parents.
   3. `EthBridgeIn.claim(...)` — verifies L2 receipt MPT proof, decodes DepositRouted, calls `MercataBridge.creditTrustlessDeposit(...)` which mints the STRATO token to the recipient.

All three execute in a single STRATO block. No relayer touched anything; the user's wallet signed each, the backend just provided data.

5. **Mint event on STRATO.** Funds are now available on STRATO.

The Ethereum and Linea paths are structurally similar; only the per-flavor light client and event shapes differ.

---

## Closing thoughts

The trustless bridge pattern isn't new — projects like [Succinct](https://succinct.xyz), [zkBridge](https://zk-bridge.org/), and Polygon's [hermez](https://github.com/0xPolygonHermez) have all built variants. What's worth emphasizing about ours is the **uniform proof shape across chains**: every bridge-in flavor reduces to "anchor an L1 receipts root, verify a receipt MPT proof, decode an event." The chain-specific machinery — beacon sync committees for Ethereum, dispute games for Base, zk finalizations for Linea — all collapse to the same final step: a `getReceiptsRoot(blockNumber)` lookup that the cross-chain primitive can build on.

That uniformity is what made adding Linea support a one-week project rather than a one-quarter project. The shared `LightClientShared.sol` library does the heavy RLP and parent-walk lifting; each new chain only needs ~250 lines for its specific event decoder.

If you want to bridge to another chain — Scroll, Polygon zkEVM, Optimism, Arbitrum — the recipe is straightforward: identify the L1 event that commits the L2 state, write a 250-line `XxxLightClient.sol` that wraps EthLightClient with that event's verification, and the rest of the stack just works.

No relayers. No multisigs in the validity path. Just consensus, all the way down.
