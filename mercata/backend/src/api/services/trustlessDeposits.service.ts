/**
 * Read-only helpers backing the trustless-claim modal's chain picker
 * and pending-deposit list. Sister of {@link trustlessBridge.service}
 * (which does writes); this file is everything the UI polls.
 *
 *   - `getFinalizedHead`        → "is this deposit ready yet?" gating
 *   - `getPendingDeposits`      → the list of unclaimed deposits for
 *                                 the user's wallets
 *
 * Both run against on-chain state only; nothing here relies on a
 * relayer or off-chain index.
 */
import { cirrus } from "../../utils/mercataApiHelper";
import { constants } from "../../config/constants";
import { ensureHexPrefix } from "../../utils/utils";
import { beaconClientFor } from "./beaconClient.service";
import {
  EthLog,
  getBlockByNumber,
  getBlockNumber,
  getLogs,
  getTransactionReceipt,
} from "./ethRpc.service";
import { ConfiguredChain } from "./trustlessBridge.service";
import { MAX_PARENT_CHAIN_HEADERS } from "./bridgeProof.service";
import { getLatestAnchoredL2BlockNumber } from "./baseProof.service";
import { keccak256 } from "../helpers/keccak.helper";

const { mercataBridge } = constants;
const EthBridgeInName = "BlockApps-EthBridgeIn";
const MercataBridgeName = "BlockApps-MercataBridge";

// ─────────────────────────────────────────────────────────────────────
// finalizedHead
// ─────────────────────────────────────────────────────────────────────

export interface FinalizedHead {
  /** EL block number (decimal string). For Eth flavor this is the
   *  beacon-chain finalized header's execution payload block number;
   *  for Base flavor v1 we just return the L1 finalized head's block
   *  number (the UI uses it as an "at-least-this-fresh" indicator). */
  blockNumber: string;
  /** Unix timestamp of `blockNumber` (seconds). */
  timestamp: string;
  /** Tag the UI renders ("Sepolia finalized at block …"). */
  flavor: "eth" | "base";
}

/**
 * Resolve the "is the deposit ready to claim?" cutoff for a chain.
 * Eth flavor → the live LightClientFinalityUpdate's finalized EL
 * block number. Base flavor → for now, the L1 finalized head; the
 * Cannon path also needs a covering DGC, but the UI surfaces that
 * lazily via the existing 425 NO_MATCHING_DISPUTE_GAME path.
 */
export async function getFinalizedHead(
  chain: ConfiguredChain,
): Promise<FinalizedHead> {
  if (chain.flavor === "eth") {
    const beacon = beaconClientFor(chain.chainId);
    const update = await beacon.getFinalityUpdate();
    const exec = update.finalized_header.execution;
    if (!exec) {
      throw new Error(
        `getFinalizedHead: chain ${chain.chainId} beacon node missing execution payload (pre-Capella?)`,
      );
    }
    return {
      blockNumber: BigInt(exec.block_number).toString(),
      timestamp: BigInt(exec.timestamp).toString(),
      flavor: "eth",
    };
  }
  // Base flavor: L2 blocks become claimable when a DisputeGameCreated
  // on L1 covers them. The deposits-list UI uses
  // `deposit.blockNumber <= finalizedHead.blockNumber` to decide
  // ready-vs-waiting, so we return the highest L2 block claimed by any
  // recent L1 DGC. Deposits newer than that show "Waiting for L1 anchor"
  // (mirroring the Eth flavor's "Waiting for finality"). Result is
  // cached in baseProof.service for a short TTL so per-second polling
  // doesn't hammer the L1 upstream.
  const latestAnchoredL2 = await getLatestAnchoredL2BlockNumber(chain.chainId);
  const headHex = await getBlockNumber(chain.chainId);
  const block = await getBlockByNumber(
    chain.chainId,
    "0x" + Math.min(latestAnchoredL2, headHex).toString(16),
  );
  return {
    blockNumber: latestAnchoredL2.toString(),
    timestamp: block?.timestamp ? BigInt(block.timestamp).toString() : "0",
    flavor: "base",
  };
}

// ─────────────────────────────────────────────────────────────────────
// pendingDeposits
// ─────────────────────────────────────────────────────────────────────

export interface PendingDeposit {
  txHash: string;
  blockNumber: string;     // decimal
  /** Unix timestamp (seconds) of the deposit block. */
  timestamp: string;
  logIndex: string;
  ethToken: string;
  ethSender: string;
  stratoRecipient: string;
  targetStratoToken: string;
  amount: string;          // decimal wei
  depositId: string;
  depositKey: string;      // keccak256(srcChainId, blockNumber, txIndex, logIndex) — used by claim()
}

/** Default search window — ~7 days on a 12s-slot chain (50_400 blocks)
 *  is in the typical RPC `eth_getLogs` budget. Tunable via env. */
const PENDING_DEPOSIT_SEARCH_BLOCKS_ENV = "PENDING_DEPOSIT_SEARCH_BLOCKS";
const PENDING_DEPOSIT_SEARCH_BLOCKS: number = (() => {
  const raw = process.env[PENDING_DEPOSIT_SEARCH_BLOCKS_ENV];
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 50_400;
})();

/** Base flavor search window: ~4h on a 2s-slot chain = 7200 blocks.
 *  Base's L2 parent-walk reach is ~256 blocks, and dispute games anchor
 *  every few minutes, so anything older is unclaimable in practice.
 *  Keeping this tight matters because Base RPC providers commonly cap
 *  eth_getLogs at 2000 blocks per call. */
const BASE_PENDING_DEPOSIT_SEARCH_BLOCKS_ENV = "BASE_PENDING_DEPOSIT_SEARCH_BLOCKS";
const BASE_PENDING_DEPOSIT_SEARCH_BLOCKS: number = (() => {
  const raw = process.env[BASE_PENDING_DEPOSIT_SEARCH_BLOCKS_ENV];
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 7_200;
})();

/** Most providers cap a single eth_getLogs span; chunk to stay under. */
const PENDING_DEPOSIT_CHUNK_BLOCKS = 5_000;

/**
 * Pad a 20-byte address to a 32-byte topic value (0x-prefixed).
 * `eth_getLogs` requires indexed-address topics in this padded form.
 */
function topicFromAddress(addr: string): string {
  const stripped = addr.replace(/^0x/, "").toLowerCase();
  if (stripped.length !== 40) {
    throw new Error(`topicFromAddress: bad address ${addr}`);
  }
  return "0x" + "0".repeat(24) + stripped;
}

/**
 * keccak256(abi.encode(srcChainId, blockNumber, txIndex, logIndex)).
 * Mirrors EthBridgeIn.claim's depositKey formula — we use this off-chain
 * to look up the `processed` mapping per pending log.
 */
function computeDepositKey(
  srcChainId: string,
  blockNumber: bigint,
  txIndex: number,
  logIndex: number,
): string {
  const a = abiPadHex(BigInt(srcChainId));
  const b = abiPadHex(blockNumber);
  const c = abiPadHex(BigInt(txIndex));
  const d = abiPadHex(BigInt(logIndex));
  const buf = Buffer.from(a + b + c + d, "hex");
  return "0x" + keccak256(buf).toString("hex");
}

function abiPadHex(v: bigint): string {
  let h = v.toString(16);
  if (h.length > 64) throw new Error(`abiPadHex: value too large for uint256: ${v}`);
  return h.padStart(64, "0");
}

/**
 * Fetch every claimed `depositKey` for a given EthBridgeIn in one
 * query, returning a Set keyed by lowercase bare-hex.
 *
 * Both ends of the trustless flow set a `bool` flag for the same key:
 *   - EthBridgeIn.processed[depositKey]                  (per-chain claim contract)
 *   - MercataBridge.processedTrustlessDeposits[depositKey] (central mint guard)
 * We merge both, treating either as authoritative — cirrus indexer
 * coverage for a freshly-deployed mapping isn't guaranteed.
 *
 * Previously this ran one cirrus GET per deposit with a `key` filter;
 * any indexer quirk in how bytes32 mapping keys are matched silently
 * returned zero rows, leaving claimed deposits visible. Pulling the
 * full set once and filtering client-side sidesteps that entirely.
 */
async function fetchProcessedSet(
  accessToken: string,
  bridgeIn: string,
): Promise<Set<string>> {
  const out = new Set<string>();
  await Promise.all([
    fillSetFromTable(out, accessToken, `${EthBridgeInName}-processed`, bridgeIn),
    fillSetFromTable(out, accessToken, `${MercataBridgeName}-processedTrustlessDeposits`, mercataBridge),
  ]);
  return out;
}

async function fillSetFromTable(
  into: Set<string>,
  accessToken: string,
  table: string,
  contractAddr: string,
): Promise<void> {
  try {
    // No server-side `value` filter: cirrus may serialize the bool as
    // `true`, `"true"`, `1`, or a JSON-encoded scalar depending on the
    // mapping value type. We fetch all rows for this contract and
    // filter truthiness in JS — robust across indexer versions.
    const { data } = await cirrus.get(accessToken, `/${table}`, {
      params: {
        address: `eq.${contractAddr.replace(/^0x/, "").toLowerCase()}`,
        select: "key,value",
      },
    });
    if (!Array.isArray(data)) return;
    for (const row of data) {
      const v = row?.value;
      const truthy =
        v === true ||
        v === "true" ||
        v === 1 ||
        v === "1" ||
        v === "True" ||
        (typeof v === "string" && v.toLowerCase() === "true");
      if (!truthy) continue;
      if (typeof row.key === "string") {
        into.add(row.key.replace(/^0x/, "").toLowerCase());
      }
    }
  } catch (e: any) {
    // Indexer/table missing or ACL-restricted — keep going with whatever
    // the other source returned. Logged so an operator can investigate
    // if both end up empty.
    console.warn(`[pendingDeposits] fetchProcessedSet(${table}) failed: ${e?.message ?? e}`);
  }
}

/**
 * Decode a single DepositRouted log into the structured form. Mirrors
 * EthBridgeIn._decodeDepositLog: indexed addresses come in as
 * 32-byte-padded topics; data is `abi.encode(amount, targetStratoToken,
 * depositId)` (3 × 32 bytes).
 *
 * IMPORTANT: `logIndex` here is the log's position **within its
 * transaction's receipt** (0-based), NOT the block-wide logIndex that
 * `eth_getLogs` returns. The contract's `claim()` indexes into
 * `receipt.logs[logIndex]` and `keccak256(abi.encode(srcChainId,
 * blockNumber, txIndex, logIndex))` is the dedup key — so anything that
 * needs to match a contract-stored depositKey must use the per-tx
 * form. The caller resolves it via receipt lookup (`resolvePerTxLogIndex`).
 */
function decodeDepositLog(log: EthLog, perTxLogIndex: number): {
  ethToken: string;
  ethSender: string;
  stratoRecipient: string;
  amount: string;
  targetStratoToken: string;
  depositId: string;
  logIndex: number;
  txIndex: number;
  blockNumber: bigint;
  txHash: string;
} {
  const ethToken = "0x" + log.topics[1].slice(-40);
  const ethSender = "0x" + log.topics[2].slice(-40);
  const stratoRecipient = "0x" + log.topics[3].slice(-40);
  const data = log.data.replace(/^0x/, "");
  if (data.length !== 192) {
    throw new Error(`decodeDepositLog: data length ${data.length}, expected 192 hex chars`);
  }
  const amount = BigInt("0x" + data.slice(0, 64)).toString();
  const targetStratoToken = "0x" + data.slice(64, 128).slice(-40);
  const depositId = BigInt("0x" + data.slice(128, 192)).toString();
  return {
    ethToken,
    ethSender,
    stratoRecipient,
    amount,
    targetStratoToken,
    depositId,
    logIndex: perTxLogIndex,
    txIndex: parseInt(log.transactionIndex, 16),
    blockNumber: BigInt(log.blockNumber),
    txHash: log.transactionHash,
  };
}

/**
 * Batch-resolve each log's block-wide logIndex into the per-transaction
 * logIndex that matches the contract's claim() convention.
 *
 * eth_getLogs returns logIndex as the position within the entire block
 * (across all txs). The contract iterates `receipt.logs[logIndex]`, so
 * the dedup key uses the per-tx index. Without this conversion the
 * computed depositKey diverges from the on-chain stored one whenever
 * a tx has earlier logs from other contracts in the same block.
 *
 * Receipts are fetched once per unique txHash and cached in a Map; each
 * input log is matched to its position in that receipt's `logs` array
 * by comparing block-wide logIndex (which IS unique within a block).
 */
async function resolvePerTxLogIndices(
  srcChainId: string,
  logs: EthLog[],
): Promise<Map<string, number>> {
  const uniqueTxs = Array.from(new Set(logs.map((l) => l.transactionHash)));
  const receiptByTx = new Map<string, Awaited<ReturnType<typeof getTransactionReceipt>>>();
  await Promise.all(
    uniqueTxs.map(async (txHash) => {
      try {
        const r = await getTransactionReceipt(srcChainId, txHash);
        if (r) receiptByTx.set(txHash, r);
      } catch {
        /* skip — this log will fall back to block-wide index below */
      }
    }),
  );

  const out = new Map<string, number>(); // key: `${txHash}|${blockWideHex}`
  for (const log of logs) {
    const receipt = receiptByTx.get(log.transactionHash);
    if (!receipt || !Array.isArray(receipt.logs)) continue;
    const blockWide = log.logIndex.toLowerCase();
    const idx = receipt.logs.findIndex(
      (rl: EthLog) => rl.logIndex.toLowerCase() === blockWide,
    );
    if (idx >= 0) {
      out.set(`${log.transactionHash}|${blockWide}`, idx);
    }
  }
  return out;
}

/**
 * Find DepositRouted logs from `chain.depositRouter` over a recent
 * window, narrowed to deposits whose stratoRecipient ∈ wallets, and
 * filtered to those not yet processed by EthBridgeIn.
 *
 * The block-timestamp lookup batches by unique blockNumber (a single
 * tx can produce multiple deposits, but they share a block).
 */
export async function getPendingDeposits(
  accessToken: string,
  chain: ConfiguredChain,
  wallets: string[],
): Promise<PendingDeposit[]> {
  if (wallets.length === 0) return [];
  // Accept both `0xabc…` and bare `abc…` forms — STRATO wallet
  // addresses commonly arrive without the 0x prefix from cirrus,
  // while EVM-side addresses arrive with it.
  const cleanWallets = wallets
    .map((w) => {
      const lower = w.toLowerCase();
      return lower.startsWith("0x") ? lower : `0x${lower}`;
    })
    .filter((w) => /^0x[0-9a-f]{40}$/.test(w));
  if (cleanWallets.length === 0) return [];

  // 1. Pull the depositRouter address from EthBridgeIn (cirrus row).
  const { data: rows } = await cirrus.get(accessToken, `/${EthBridgeInName}`, {
    params: {
      address: `eq.${chain.bridgeIn.replace(/^0x/, "")}`,
      select: "depositRouter",
    },
  });
  const depositRouter = rows?.[0]?.depositRouter
    ? ensureHexPrefix(rows[0].depositRouter)
    : undefined;
  if (!depositRouter) {
    throw new Error(`getPendingDeposits: depositRouter not set on bridgeIn ${chain.bridgeIn}`);
  }

  // 2. Compute the eth_getLogs filter — chunked across the search
  //    window. Topic[0] = depositRoutedSig, topic[3] = recipients.
  //
  //    Lower bound = max(0, finalized − MAX_PARENT_CHAIN_HEADERS,
  //                          head − PENDING_DEPOSIT_SEARCH_BLOCKS).
  //    Anything older than the parent-chain reach is unclaimable
  //    (anchor would revert at the cap), so we hide it from the list.
  //    Base flavor doesn't use this cutoff — the L2 cutoff would
  //    require a Base-specific finalization concept, and per-claim
  //    NO_MATCHING_DISPUTE_GAME / DEPOSIT_TOO_OLD already handle
  //    rejection there.
  const headBlock = await getBlockNumber(chain.chainId);
  let claimReachLowerBound = 0;
  if (chain.flavor === "eth") {
    try {
      const head = await getFinalizedHead(chain);
      const finalizedNum = Number(BigInt(head.blockNumber));
      claimReachLowerBound = Math.max(0, finalizedNum - MAX_PARENT_CHAIN_HEADERS);
    } catch {
      // Beacon hiccup — fall back to the absolute search-window cap.
    }
  }
  // For Base flavor we don't have a beacon-anchored lower bound, but
  // the L2 parent-walk reach is short (~256 blocks ≈ 8.5min on 2s slots)
  // and dispute games anchor on the order of minutes, so deposits older
  // than a few hours are practically unclaimable anyway. A ~4h cap
  // keeps the eth_getLogs scan from ballooning into many provider-capped
  // chunks while still surfacing anything a user could realistically claim.
  const flavorSearchCap =
    chain.flavor === "base" ? BASE_PENDING_DEPOSIT_SEARCH_BLOCKS : PENDING_DEPOSIT_SEARCH_BLOCKS;
  const fromBlock = Math.max(
    0,
    claimReachLowerBound,
    headBlock - flavorSearchCap,
  );
  const recipientTopic = cleanWallets.map(topicFromAddress);

  // Chunk size is adaptive: we start at PENDING_DEPOSIT_CHUNK_BLOCKS,
  // and if the RPC complains about exceeding its block range we halve
  // and retry. Once a provider's cap is established it stays in effect
  // for the rest of this request — Base Sepolia caps at 2000, mainnet
  // providers commonly cap at 10_000, so the right size varies.
  const allLogs: EthLog[] = [];
  let chunkSize = PENDING_DEPOSIT_CHUNK_BLOCKS;
  let from = fromBlock;
  while (from <= headBlock) {
    const to = Math.min(headBlock, from + chunkSize - 1);
    try {
      const chunk = await getLogs(chain.chainId, {
        address: depositRouter,
        fromBlock: "0x" + from.toString(16),
        toBlock: "0x" + to.toString(16),
        topics: [chain.depositRoutedSig, null, null, recipientTopic],
      });
      allLogs.push(...chunk);
      from = to + 1;
    } catch (e: any) {
      const msg = String(e?.message ?? e ?? "");
      if (/max block range|exceeds.*block range|range is too|block range too large/i.test(msg) && chunkSize > 100) {
        chunkSize = Math.max(100, Math.floor(chunkSize / 2));
        console.warn(`[pendingDeposits] eth_getLogs chunk too large for chain ${chain.chainId}; retrying with chunk=${chunkSize}`);
        continue; // don't advance `from`; retry the same range with smaller chunk
      }
      throw e;
    }
  }
  if (allLogs.length === 0) return [];

  // 3. Decode + filter out the already-processed rows. We resolve
  //    timestamps in parallel per unique block.
  const uniqueBlocks = Array.from(
    new Set(allLogs.map((l) => l.blockNumber)),
  );
  const blockTimestamps = new Map<string, string>();
  await Promise.all(
    uniqueBlocks.map(async (bnHex) => {
      try {
        const block = await getBlockByNumber(chain.chainId, bnHex);
        if (block?.timestamp) {
          blockTimestamps.set(bnHex, BigInt(block.timestamp).toString());
        }
      } catch {
        /* leave undefined; UI shows "—" */
      }
    }),
  );

  // Resolve each log's per-tx logIndex before decoding — the contract's
  // depositKey formula needs it, and it's also what claim() takes.
  const perTxIdx = await resolvePerTxLogIndices(chain.chainId, allLogs);
  const decoded = allLogs
    .map((l) => {
      const idx = perTxIdx.get(`${l.transactionHash}|${l.logIndex.toLowerCase()}`);
      if (idx === undefined) {
        console.warn(
          `[pendingDeposits] could not resolve per-tx logIndex for ${l.transactionHash}:${l.logIndex}; skipping`,
        );
        return undefined;
      }
      return decodeDepositLog(l, idx);
    })
    .filter((d): d is ReturnType<typeof decodeDepositLog> => d !== undefined);

  // 4. Drop already-processed via the on-chain `processed` mappings.
  //    Bulk-fetch the full set once and check membership locally — one
  //    cirrus round trip per request, regardless of how many deposits.
  const processedSet = await fetchProcessedSet(accessToken, chain.bridgeIn);
  const filtered = decoded
    .map((d) => ({
      d,
      depositKey: computeDepositKey(chain.chainId, d.blockNumber, d.txIndex, d.logIndex),
    }))
    .filter(({ depositKey }) => !processedSet.has(depositKey.replace(/^0x/, "").toLowerCase()));

  return filtered
    .map(({ d, depositKey }) => ({
      txHash: d.txHash,
      blockNumber: d.blockNumber.toString(),
      timestamp: blockTimestamps.get("0x" + d.blockNumber.toString(16)) ?? "0",
      logIndex: d.logIndex.toString(),
      ethToken: d.ethToken,
      ethSender: d.ethSender,
      stratoRecipient: d.stratoRecipient,
      targetStratoToken: d.targetStratoToken,
      amount: d.amount,
      depositId: d.depositId,
      depositKey,
    }))
    .sort((a, b) => Number(BigInt(b.blockNumber) - BigInt(a.blockNumber))); // newest first
}
