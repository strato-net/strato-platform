/**
 * Trustless bridge-in orchestrator.
 *
 * Fronts the per-chain proof builders ({@link bridgeProof.service} for
 * Ethereum, {@link baseProof.service} for OP-Stack/Cannon Base) and
 * packages the resulting inputs into a STRATO transaction batch the
 * user's wallet signs. Dispatch is on `srcChainId`:
 *
 *   Ethereum (1, 11155111)          → 1-2 txs
 *     (1) EthLightClient.anchorBlockHeader   (skipped if already anchored)
 *     (2) EthBridgeIn.claim
 *
 *   Base / OP-Stack (8453, 84532)   → 1-3 txs
 *     (1) EthLightClient.anchorBlockHeader   (L1 anchor; skipped if already)
 *     (2) BaseLightClient.anchorBaseBlockChainViaCannon  (skipped if deposit
 *                                                         block already anchored)
 *     (3) EthBridgeIn.claim
 *
 * Each per-chain bridge-in deployment is a separate {EthBridgeIn}
 * instance pointing at the right light client; MercataBridge.bridgeIns
 * is the (chainId → bridgeIn) mapping that gates which one can call
 * {creditTrustlessDeposit} for which source.
 */
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForAllTxs } from "../../utils/txHelper";
import { strato, cirrus } from "../../utils/mercataApiHelper";
import { StratoPaths, constants } from "../../config/constants";
import { extractContractName, ensureHexPrefix } from "../../utils/utils";
import {
  buildAnchorInputs,
  buildAnchorInputsViaStateProof,
  buildClaimInputs,
  buildPeriodTransitions,
  AnchorInputs,
  BlockRootsAnchorInputs,
  ClaimInputs,
  HistoricalSummariesAnchorInputs,
  PeriodTransitionJSON,
  StateProofAnchorInputs,
} from "./bridgeProof.service";
import {
  BaseAnchorChainInputs,
  buildBaseAnchorChainInputsViaCannon,
  buildBaseClaimInputs,
} from "./baseProof.service";
import {
  LineaAnchorChainInputs,
  buildLineaAnchorChainInputs,
  buildLineaClaimInputs,
} from "./lineaProof.service";

const { MercataBridge, mercataBridge } = constants;
const EthBridgeInName    = "BlockApps-EthBridgeIn";
const EthLightClientName = "BlockApps-EthLightClient";
const BaseLightClientName = "BlockApps-BaseLightClient";
const LineaLightClientName = "BlockApps-LineaLightClient";

/**
 * Tag identifying which on-chain anchor flow a given source chain
 * uses. Drives both the contract dispatch (which method to call) and
 * the proof-builder selection (which off-chain service runs).
 */
type LightClientFlavor = "eth" | "base" | "linea";

const FLAVOR_BY_CHAIN_ID: Record<string, LightClientFlavor> = {
  "1":        "eth",
  "11155111": "eth",
  "8453":     "base",
  "84532":    "base",
  "59144":    "linea",
  "59141":    "linea",
};

/** Display name for a supported source chain. Used by
 *  {@link listConfiguredChains} so the UI doesn't have to map chainId
 *  → label client-side. */
const CHAIN_NAMES: Record<string, string> = {
  "1":        "Ethereum",
  "11155111": "Sepolia",
  "8453":     "Base",
  "84532":    "Base Sepolia",
  "59144":    "Linea",
  "59141":    "Linea Sepolia",
};

export interface TrustlessClaimParams {
  externalChainId: string;
  externalTxHash: string;
  /**
   * Optional ClaimAssignment for the LP fast-finality path. When present,
   * the claim is credited to `assignment.newRecipient` instead of the
   * stratoRecipient encoded in the source-chain log.
   */
  assignment?: {
    depositKey: string;
    newRecipient: string;
    deadline: string;
    v: number;
    r: string;
    s: string;
  };
}

export interface TrustlessClaimResponse {
  status?: string;
  hashes: string[];
  /** True iff the deposit's block was already anchored — saved one anchor tx. */
  anchorSkipped: boolean;
  /** True iff the L1 block was already anchored (Base flavor only). */
  l1AnchorSkipped: boolean;
  /** Number of `advanceCommittee` txs prepended to the batch to catch
   *  up the EthLightClient's sync-committee chain. 0 in the steady-
   *  state case where a relayer keeps committees fresh. */
  committeeAdvanceCount: number;
  blockNumber: string;
  flavor: LightClientFlavor;
}

/** Per-source-chain config returned by {@link loadTrustlessConfig}. */
export interface TrustlessConfig {
  flavor: LightClientFlavor;
  /** EthBridgeIn deployment on STRATO that's registered for this source chain. */
  bridgeIn: string;
  /** Light client {EthBridgeIn.lightClient} points at — Eth flavor → an
   *  EthLightClient; Base flavor → a BaseLightClient. */
  lightClient: string;
  depositRoutedSig: string;
  /**
   * Base flavor only: the L1 EthLightClient address the BaseLightClient
   * wraps (== `BaseLightClient.l1LightClient`). Required because the
   * Cannon flow needs both an L1 anchor (on this contract) AND a
   * Base-side anchor (on `lightClient`).
   */
  l1LightClient?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Config discovery (cirrus)
// ─────────────────────────────────────────────────────────────────────

/**
 * Resolve the per-chain trustless config from on-chain state. Throws
 * if the chain isn't supported or no bridge-in is registered for it.
 */
export const loadTrustlessConfig = async (
  accessToken: string,
  srcChainId: string,
): Promise<TrustlessConfig> => {
  const flavor = FLAVOR_BY_CHAIN_ID[srcChainId];
  if (!flavor) {
    throw new Error(`MB: chainId ${srcChainId} not supported by trustless path`);
  }

  // 1. MercataBridge.bridgeIns[srcChainId] — the per-chain mapping.
  const { data: mbRows } = await cirrus.get(accessToken, `/${MercataBridge}-bridgeIns`, {
    params: {
      address: `eq.${mercataBridge}`,
      key: `eq.${srcChainId}`,
      select: "value",
    },
  });
  const bridgeInRaw = mbRows?.[0]?.value;
  if (!bridgeInRaw || /^0+$/.test(String(bridgeInRaw).replace(/^0x/, ""))) {
    throw new Error(`MB: trustless path disabled for chain ${srcChainId}`);
  }
  const bridgeIn = ensureHexPrefix(bridgeInRaw);

  // 2. EthBridgeIn.lightClient + .depositRoutedSig — same shape regardless
  //    of flavor (the bridge-in template is the same; only the light
  //    client it points at differs).
  const { data: bridgeInRows } = await cirrus.get(accessToken, `/${EthBridgeInName}`, {
    params: {
      address: `eq.${bridgeIn.replace(/^0x/, "")}`,
      select: "lightClient,depositRoutedSig",
    },
  });
  const row = bridgeInRows?.[0];
  if (!row) throw new Error(`EthBridgeIn ${bridgeIn} not found in cirrus`);
  const lightClient = ensureHexPrefix(row.lightClient);
  const depositRoutedSig = ensureHexPrefix(row.depositRoutedSig);
  if (!lightClient || /^0+$/.test(lightClient.replace(/^0x/, ""))) {
    throw new Error("EthBridgeIn: lightClient unset");
  }
  if (!depositRoutedSig || /^0+$/.test(depositRoutedSig.replace(/^0x/, ""))) {
    throw new Error("EthBridgeIn: depositRoutedSig unset");
  }

  if (flavor === "eth") {
    return { flavor, bridgeIn, lightClient, depositRoutedSig };
  }

  // 3. Base / Linea flavors: also fetch the wrapped EthLightClient
  //    address so we can submit the L1 anchor tx to the right contract.
  //    Both wrapper contracts use the same `l1LightClient` field name.
  const wrapperName = flavor === "base" ? BaseLightClientName : LineaLightClientName;
  const { data: wrapperRows } = await cirrus.get(accessToken, `/${wrapperName}`, {
    params: {
      address: `eq.${lightClient.replace(/^0x/, "")}`,
      select: "l1LightClient",
    },
  });
  const wrapperRow = wrapperRows?.[0];
  if (!wrapperRow) throw new Error(`${wrapperName} ${lightClient} not found in cirrus`);
  const l1LightClient = ensureHexPrefix(wrapperRow.l1LightClient);
  if (!l1LightClient || /^0+$/.test(l1LightClient.replace(/^0x/, ""))) {
    throw new Error(`${wrapperName}: l1LightClient unset`);
  }

  return { flavor, bridgeIn, lightClient, depositRoutedSig, l1LightClient };
};

/** One row of {@link listConfiguredChains}. */
export interface ConfiguredChain {
  chainId: string;
  name: string;
  flavor: LightClientFlavor;
  bridgeIn: string;
  lightClient: string;
  depositRoutedSig: string;
  /** Base flavor only — the wrapped L1 EthLightClient. */
  l1LightClient?: string;
}

/**
 * Enumerate every source chain that has a non-zero `bridgeIns[chainId]`
 * entry on MercataBridge AND a flavor we know how to bridge from.
 * Drives the chain-button picker on the trustless claim modal.
 *
 * Each row is hydrated with the same fields {@link loadTrustlessConfig}
 * returns, so the modal can stash the full bundle and skip the per-row
 * config fetch when the user picks one.
 */
export const listConfiguredChains = async (
  accessToken: string,
): Promise<ConfiguredChain[]> => {
  // 1. All bridgeIns rows on MercataBridge — postgrest returns the
  //    full mapping when we omit the `key` filter.
  const { data: rows } = await cirrus.get(
    accessToken,
    `/${MercataBridge}-bridgeIns`,
    { params: { address: `eq.${mercataBridge}`, select: "key,value" } },
  );
  if (!Array.isArray(rows)) return [];

  // 2. Filter to (a) chains we have a flavor for and (b) non-zero
  //    bridgeIn entries (deletion stamps the value back to 0x0…).
  const candidates = rows
    .map((r: any) => ({
      chainId: String(r.key),
      bridgeIn: ensureHexPrefix(String(r.value)),
    }))
    .filter(
      ({ chainId, bridgeIn }) =>
        FLAVOR_BY_CHAIN_ID[chainId] &&
        !/^0+$/.test(bridgeIn.replace(/^0x/, "")),
    );
  if (candidates.length === 0) return [];

  // 3. Hydrate. We could parallel-await loadTrustlessConfig per chain
  //    but that re-queries bridgeIns; doing the lightClient lookup
  //    inline saves a round-trip per row.
  const results = await Promise.all(
    candidates.map(async ({ chainId, bridgeIn }): Promise<ConfiguredChain | undefined> => {
      try {
        const cfg = await loadTrustlessConfig(accessToken, chainId);
        return {
          chainId,
          name: CHAIN_NAMES[chainId] ?? `Chain ${chainId}`,
          flavor: cfg.flavor,
          bridgeIn: cfg.bridgeIn,
          lightClient: cfg.lightClient,
          depositRoutedSig: cfg.depositRoutedSig,
          l1LightClient: cfg.l1LightClient,
        };
      } catch {
        // A registered bridgeIn whose template-row is missing in cirrus
        // is a misconfiguration — skip rather than 500 the whole list.
        return undefined;
      }
    }),
  );
  return results.filter((r): r is ConfiguredChain => !!r);
};

/**
 * Read `EthLightClient.latestPeriod` — the highest sync-committee
 * period whose committeePubkeys[period] is anchored. Used to decide
 * how many `advanceCommittee` txs to prepend so the deposit's signing
 * committee is in scope.
 *
 * Returns undefined if the row doesn't exist or the field is null;
 * caller treats that as "can't determine, skip the catchup".
 */
const fetchLatestAnchoredPeriod = async (
  accessToken: string,
  lightClient: string,
): Promise<bigint | undefined> => {
  try {
    const { data } = await cirrus.get(accessToken, `/${EthLightClientName}`, {
      params: {
        address: `eq.${lightClient.replace(/^0x/, "")}`,
        select: "latestPeriod",
      },
    });
    const v = data?.[0]?.latestPeriod;
    if (v === undefined || v === null) return undefined;
    return BigInt(v);
  } catch {
    return undefined;
  }
};

/**
 * Read EthLightClient.anchored[blockNumber]. Returns the receiptsRoot
 * (zero bytes32 if not anchored). Same idempotency optimization that
 * the Eth-only orchestrator used.
 */
const fetchEthLightClientAnchor = async (
  accessToken: string,
  lightClient: string,
  blockNumber: string,
): Promise<string | undefined> => {
  const v = await fetchMappingValue(
    accessToken,
    `${EthLightClientName}-anchored`,
    lightClient,
    blockNumber,
  );
  return typeof v === "string" ? v : undefined;
};

/**
 * Read BaseLightClient.anchoredFlag[blockNumber]. Returns true iff
 * the Base block has already been anchored — lets us skip both the
 * L1 anchor and the Base anchor when someone else has already
 * processed the same source-chain block.
 */
const fetchBaseLightClientAnchored = async (
  accessToken: string,
  lightClient: string,
  blockNumber: string,
): Promise<boolean> => {
  const v = await fetchMappingValue(
    accessToken,
    `${BaseLightClientName}-anchoredFlag`,
    lightClient,
    blockNumber,
  );
  return v === true || v === "true";
};

/**
 * Read LineaLightClient.anchoredFlag[blockNumber]. Same shape as the
 * Base reader — both wrapper contracts use the same `anchoredFlag`
 * field name for the per-block "already anchored?" mapping.
 */
const fetchLineaLightClientAnchored = async (
  accessToken: string,
  lightClient: string,
  blockNumber: string,
): Promise<boolean> => {
  const v = await fetchMappingValue(
    accessToken,
    `${LineaLightClientName}-anchoredFlag`,
    lightClient,
    blockNumber,
  );
  return v === true || v === "true";
};

const fetchMappingValue = async (
  accessToken: string,
  table: string,
  contractAddr: string,
  key: string,
): Promise<unknown | undefined> => {
  try {
    const { data } = await cirrus.get(accessToken, `/${table}`, {
      params: {
        address: `eq.${contractAddr.replace(/^0x/, "")}`,
        key: `eq.${key}`,
        select: "value",
      },
    });
    const v = data?.[0]?.value;
    if (v === undefined || v === null) return undefined;
    if (typeof v === "string") {
      const stripped = v.replace(/^0x/, "");
      if (/^0+$/.test(stripped)) return undefined;
      return ensureHexPrefix(v);
    }
    return v;
  } catch {
    return undefined;
  }
};

// ─────────────────────────────────────────────────────────────────────
// Tx-builder helpers — one per (flavor, method)
//
// SolidVM JSON-RPC ABI requires bytesN / bytes args as Base16 strings
// without a "0x" prefix; addresses are left prefixed (the engine
// accepts both for `address`). We strip prefixes per-field rather
// than walking blindly because addresses live alongside hashes in
// these structs.
// ─────────────────────────────────────────────────────────────────────

const strip0x = (s: string): string =>
  typeof s === "string" && s.startsWith("0x") ? s.slice(2) : s;
const strip0xArr = (a: string[]): string[] => a.map(strip0x);

/**
 * Split a hex string (no 0x prefix) into N×64-char chunks (one per
 * bytes32). Right-pads the final chunk with zeros if `s` is shorter
 * than `chunks * 64`. Used to hand SolidVM a `bytes32[N]` argument
 * that round-trips correctly through its JSON-RPC ABI for variable
 * `bytes` nested in a struct (which doesn't decode otherwise).
 */
const chunkBytes32 = (s: string, chunks: number): string[] => {
  const stripped = strip0x(s);
  const expected = chunks * 64;
  if (stripped.length > expected) {
    throw new Error(
      `chunkBytes32: hex too long for bytes32[${chunks}] (${stripped.length / 2} bytes > ${chunks * 32})`,
    );
  }
  const padded = stripped.padEnd(expected, "0");
  const out: string[] = [];
  for (let i = 0; i < chunks; i++) {
    out.push(padded.slice(i * 64, (i + 1) * 64));
  }
  return out;
};

const buildEthAnchorArgs = (anchor: AnchorInputs) => ({
  headers: {
    attestedSlot:           anchor.headers.attestedSlot,
    attestedProposerIndex:  anchor.headers.attestedProposerIndex,
    attestedParentRoot:     strip0x(anchor.headers.attestedParentRoot),
    attestedStateRoot:      strip0x(anchor.headers.attestedStateRoot),
    attestedBodyRoot:       strip0x(anchor.headers.attestedBodyRoot),
    finalizedSlot:          anchor.headers.finalizedSlot,
    finalizedProposerIndex: anchor.headers.finalizedProposerIndex,
    finalizedParentRoot:    strip0x(anchor.headers.finalizedParentRoot),
    finalizedStateRoot:     strip0x(anchor.headers.finalizedStateRoot),
    finalizedBodyRoot:      strip0x(anchor.headers.finalizedBodyRoot),
    finalityBranch:         strip0xArr(anchor.headers.finalityBranch),
  },
  sync: {
    // SolidVM ABI workaround: bytes nested in a struct doesn't
    // round-trip via JSON-RPC; chunk into bytes32[N] which does.
    participationBits: chunkBytes32(anchor.sync.participationBits, 2),  // 64 bytes
    signature:         chunkBytes32(anchor.sync.signature, 3),           // 96 bytes
    signatureSlot:     anchor.sync.signatureSlot,
  },
  parentChain: anchor.parentChain.map((p) => ({
    slot:          p.slot,
    proposerIndex: p.proposerIndex,
    parentRoot:    strip0x(p.parentRoot),
    stateRoot:     strip0x(p.stateRoot),
    bodyRoot:      strip0x(p.bodyRoot),
  })),
  eph: {
    parentHash:       strip0x(anchor.eph.parentHash),
    feeRecipient:     anchor.eph.feeRecipient,
    stateRoot:        strip0x(anchor.eph.stateRoot),
    receiptsRoot:     strip0x(anchor.eph.receiptsRoot),
    logsBloomRoot:    strip0x(anchor.eph.logsBloomRoot),
    prevRandao:       strip0x(anchor.eph.prevRandao),
    blockNumber:      anchor.eph.blockNumber,
    gasLimit:         anchor.eph.gasLimit,
    gasUsed:          anchor.eph.gasUsed,
    timestamp:        anchor.eph.timestamp,
    extraDataRoot:    strip0x(anchor.eph.extraDataRoot),
    baseFeePerGas:    anchor.eph.baseFeePerGas,
    blockHash:        strip0x(anchor.eph.blockHash),
    transactionsRoot: strip0x(anchor.eph.transactionsRoot),
    withdrawalsRoot:  strip0x(anchor.eph.withdrawalsRoot),
    blobGasUsed:      anchor.eph.blobGasUsed,
    excessBlobGas:    anchor.eph.excessBlobGas,
  },
  executionBranch: strip0xArr(anchor.executionBranch),
});

/** Common header/sync/eph/executionBranch envelope shared by the
 *  state-proof entrypoints. Factored out because the parent-walk and
 *  state-proof entrypoints both ride the same prelude. */
const buildEthAnchorEnvelope = (anchor: StateProofAnchorInputs) => ({
  headers: {
    attestedSlot:           anchor.headers.attestedSlot,
    attestedProposerIndex:  anchor.headers.attestedProposerIndex,
    attestedParentRoot:     strip0x(anchor.headers.attestedParentRoot),
    attestedStateRoot:      strip0x(anchor.headers.attestedStateRoot),
    attestedBodyRoot:       strip0x(anchor.headers.attestedBodyRoot),
    finalizedSlot:          anchor.headers.finalizedSlot,
    finalizedProposerIndex: anchor.headers.finalizedProposerIndex,
    finalizedParentRoot:    strip0x(anchor.headers.finalizedParentRoot),
    finalizedStateRoot:     strip0x(anchor.headers.finalizedStateRoot),
    finalizedBodyRoot:      strip0x(anchor.headers.finalizedBodyRoot),
    finalityBranch:         strip0xArr(anchor.headers.finalityBranch),
  },
  sync: {
    participationBits: chunkBytes32(anchor.sync.participationBits, 2),
    signature:         chunkBytes32(anchor.sync.signature, 3),
    signatureSlot:     anchor.sync.signatureSlot,
  },
  target: {
    slot:          anchor.target.slot,
    proposerIndex: anchor.target.proposerIndex,
    parentRoot:    strip0x(anchor.target.parentRoot),
    stateRoot:     strip0x(anchor.target.stateRoot),
    bodyRoot:      strip0x(anchor.target.bodyRoot),
  },
  eph: {
    parentHash:       strip0x(anchor.eph.parentHash),
    feeRecipient:     anchor.eph.feeRecipient,
    stateRoot:        strip0x(anchor.eph.stateRoot),
    receiptsRoot:     strip0x(anchor.eph.receiptsRoot),
    logsBloomRoot:    strip0x(anchor.eph.logsBloomRoot),
    prevRandao:       strip0x(anchor.eph.prevRandao),
    blockNumber:      anchor.eph.blockNumber,
    gasLimit:         anchor.eph.gasLimit,
    gasUsed:          anchor.eph.gasUsed,
    timestamp:        anchor.eph.timestamp,
    extraDataRoot:    strip0x(anchor.eph.extraDataRoot),
    baseFeePerGas:    anchor.eph.baseFeePerGas,
    blockHash:        strip0x(anchor.eph.blockHash),
    transactionsRoot: strip0x(anchor.eph.transactionsRoot),
    withdrawalsRoot:  strip0x(anchor.eph.withdrawalsRoot),
    blobGasUsed:      anchor.eph.blobGasUsed,
    excessBlobGas:    anchor.eph.excessBlobGas,
  },
  executionBranch: strip0xArr(anchor.executionBranch),
});

const buildEthAnchorViaBlockRootsArgs = (anchor: BlockRootsAnchorInputs) => {
  const env = buildEthAnchorEnvelope(anchor);
  return {
    headers:          env.headers,
    sync:             env.sync,
    target:           env.target,
    blockRootsBranch: strip0xArr(anchor.blockRootsBranch),
    eph:              env.eph,
    executionBranch:  env.executionBranch,
  };
};

const buildEthAnchorViaHistoricalSummariesArgs = (anchor: HistoricalSummariesAnchorInputs) => {
  const env = buildEthAnchorEnvelope(anchor);
  return {
    headers:           env.headers,
    sync:              env.sync,
    target:            env.target,
    summaryIndex:      anchor.summaryIndex,
    historicalBranch:  strip0xArr(anchor.historicalBranch),
    eph:               env.eph,
    executionBranch:   env.executionBranch,
  };
};

const buildAdvanceCommitteeArgs = (p: PeriodTransitionJSON) => ({
  update: {
    attestedSlot:           p.attestedSlot,
    attestedProposerIndex:  p.attestedProposerIndex,
    attestedParentRoot:     strip0x(p.attestedParentRoot),
    attestedStateRoot:      strip0x(p.attestedStateRoot),
    attestedBodyRoot:       strip0x(p.attestedBodyRoot),
    // Chunked bytes32[N] form — see SyncAggregateInput in
    // EthLightClient.sol for why nested `bytes` struct fields
    // can't ride the wire.
    participationBits:      chunkBytes32(p.participationBits, 2),  // 64 bytes
    signature:              chunkBytes32(p.signature, 3),           // 96 bytes
    signatureSlot:          p.signatureSlot,
    nextPubkeys:            strip0xArr(p.nextPubkeys),
    // 48-byte BLS pubkey + 16-byte SSZ right-pad → bytes32[2].
    nextAggregatePubkey:    chunkBytes32(p.nextAggregatePubkey, 2),
    nextBranch:             strip0xArr(p.nextBranch),
  },
});

const buildBaseAnchorArgs = (b: BaseAnchorChainInputs) => ({
  proof: {
    l1BlockNumber:     b.l1BlockNumber,
    txIndex:           b.txIndex,
    logIndex:          b.logIndex,
    receiptValueBytes: strip0x(b.receiptValueBytes),
    mptProof:          strip0xArr(b.mptProof),
  },
  baseHeaderRLP:         strip0x(b.anchorHeaderRLP),
  withdrawalStorageRoot: strip0x(b.withdrawalStorageRoot),
  parentChain:           strip0xArr(b.parentChain),
});

const buildLineaAnchorArgs = (b: LineaAnchorChainInputs) => ({
  proof: {
    l1BlockNumber:     b.l1BlockNumber,
    txIndex:           b.txIndex,
    logIndex:          b.logIndex,
    receiptValueBytes: strip0x(b.receiptValueBytes),
    mptProof:          strip0xArr(b.mptProof),
  },
  lineaHeaderRLP:        strip0x(b.lineaHeaderRLP),
  parentChain:           strip0xArr(b.parentChain),
});

const ZERO_BYTES32 =
  "0000000000000000000000000000000000000000000000000000000000000000";
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

const buildClaimArgs = (
  claim: ClaimInputs,
  assignment: TrustlessClaimParams["assignment"],
) => ({
  blockNumber:       claim.blockNumber,
  txIndex:           claim.txIndex,
  logIndex:          claim.logIndex,
  receiptValueBytes: strip0x(claim.receiptValueBytes),
  mptProof:          strip0xArr(claim.mptProof),
  assignment: assignment
    ? {
        depositKey:   strip0x(assignment.depositKey),
        newRecipient: assignment.newRecipient,
        deadline:     assignment.deadline,
        v:            assignment.v,
        r:            strip0x(assignment.r),
        s:            strip0x(assignment.s),
      }
    : {
        depositKey:   ZERO_BYTES32,
        newRecipient: ZERO_ADDR,
        deadline:     "0",
        v:            0,
        r:            ZERO_BYTES32,
        s:            ZERO_BYTES32,
      },
});

// ─────────────────────────────────────────────────────────────────────
// Sync-committee catchup
// ─────────────────────────────────────────────────────────────────────

/** Slots per sync-committee period: SLOTS_PER_EPOCH (32) ×
 *  EPOCHS_PER_SYNC_COMMITTEE_PERIOD (256). */
const SLOTS_PER_PERIOD = 8192n;

/** Map a source chain to the L1 beacon chain whose period transitions
 *  drive its EthLightClient. Eth flavor → itself; Base flavor → its L1. */
function beaconChainIdFor(srcChainId: string, flavor: LightClientFlavor): string {
  if (flavor === "eth") return srcChainId;
  switch (srcChainId) {
    case "8453":  return "1";          // Base mainnet → Eth mainnet
    case "84532": return "11155111";   // Base Sepolia → Eth Sepolia
    case "59144": return "1";          // Linea mainnet → Eth mainnet
    case "59141": return "11155111";   // Linea Sepolia → Eth Sepolia
    default: throw new Error(`beaconChainIdFor: no mapping for L2 chain ${srcChainId}`);
  }
}

/**
 * Build the (possibly-empty) sequence of `advanceCommittee` txs that
 * catch the EthLightClient's sync-committee chain up to the period
 * needed by an upcoming `anchorBlockHeader` call.
 *
 * `anchorBlockHeader` requires `committeePubkeys[period(sync.signatureSlot)]`
 * to exist; if the LC is N periods behind, we need N updates. The
 * permissionless `advanceCommittee` is idempotent, so racing relayers
 * don't break us — but we still skip the call when the chain is
 * already caught up (no point paying gas).
 */
async function buildAdvanceCommitteeTxsIfNeeded(
  accessToken: string,
  beaconChainId: string,
  ethLightClient: string,
  signatureSlot: string,
): Promise<Array<{ contractName: string; contractAddress: string; method: string; args: Record<string, any> }>> {
  const signaturePeriod = BigInt(signatureSlot) / SLOTS_PER_PERIOD;
  const latest = await fetchLatestAnchoredPeriod(accessToken, ethLightClient);
  if (latest === undefined) {
    // Can't determine the LC's state — let the on-chain call surface
    // the error if a committee is missing. Don't blindly insert
    // catchup txs that would compete with admin bootstrap windows.
    return [];
  }
  if (latest >= signaturePeriod) return [];
  const startPeriod = Number(latest);
  const count = Number(signaturePeriod - latest);
  const transitions = await buildPeriodTransitions(beaconChainId, startPeriod, count);
  return transitions.map((t) => ({
    contractName: extractContractName(EthLightClientName),
    contractAddress: ethLightClient,
    method: "advanceCommittee",
    args: buildAdvanceCommitteeArgs(t),
  }));
}

// ─────────────────────────────────────────────────────────────────────
// Main entry
// ─────────────────────────────────────────────────────────────────────

export const trustlessClaim = async (
  accessToken: string,
  { externalChainId, externalTxHash, assignment }: TrustlessClaimParams,
  userAddress: string,
): Promise<TrustlessClaimResponse> => {
  const cfg = await loadTrustlessConfig(accessToken, externalChainId);

  // Build the claim inputs first (the loudest place to fail — bad
  // tx hash, missing log, etc.). ClaimInputs shape is identical
  // across flavors so the downstream packing is uniform.
  const claim: ClaimInputs =
    cfg.flavor === "base"
      ? await buildBaseClaimInputs(externalChainId, externalTxHash, cfg.depositRoutedSig)
      : cfg.flavor === "linea"
        ? await buildLineaClaimInputs(externalChainId, externalTxHash, cfg.depositRoutedSig)
        : await buildClaimInputs(externalChainId, externalTxHash, cfg.depositRoutedSig);

  const txInputs: Array<{ contractName: string; contractAddress: string; method: string; args: Record<string, any> }> = [];
  let l1AnchorSkipped = false;
  let anchorSkipped = false;
  let committeeAdvanceCount = 0;

  if (cfg.flavor === "eth") {
    // Single-block Eth path: anchor on EthLightClient if needed, claim.
    const alreadyAnchored = await fetchEthLightClientAnchor(
      accessToken, cfg.lightClient, claim.blockNumber,
    );
    anchorSkipped = !!alreadyAnchored;
    if (!alreadyAnchored) {
      // State-proof anchor (block_roots / historical_summaries). One
      // BeaconState fetch (~50 MB on Sepolia) + a 19- or 45-deep
      // Merkle proof, vs the legacy parent-chain walk's O(N) sequential
      // beacon `getHeader` fetches and on-chain `hashTreeRootBeaconHeader`
      // calls (where N grew quadratically with deposit age).
      const anchor = await buildAnchorInputsViaStateProof(
        externalChainId, externalTxHash,
      );

      // Catch up sync-committee chain on the LC if it's behind the
      // deposit's signaturePeriod — anchor would otherwise revert
      // with "no committee for this period".
      const advances = await buildAdvanceCommitteeTxsIfNeeded(
        accessToken,
        beaconChainIdFor(externalChainId, "eth"),
        cfg.lightClient,
        anchor.sync.signatureSlot,
      );
      committeeAdvanceCount = advances.length;
      txInputs.push(...advances);

      if (anchor.kind === "block_roots") {
        txInputs.push({
          contractName: extractContractName(EthLightClientName),
          contractAddress: cfg.lightClient,
          method: "anchorBlockHeaderViaBlockRoots",
          args: buildEthAnchorViaBlockRootsArgs(anchor),
        });
      } else {
        txInputs.push({
          contractName: extractContractName(EthLightClientName),
          contractAddress: cfg.lightClient,
          method: "anchorBlockHeaderViaHistoricalSummaries",
          args: buildEthAnchorViaHistoricalSummariesArgs(anchor),
        });
      }
    }
  } else if (cfg.flavor === "base") {
    // Base/Cannon path. Three potential txs; we skip whichever steps
    // are already on-chain.
    const alreadyAnchoredBase = await fetchBaseLightClientAnchored(
      accessToken, cfg.lightClient, claim.blockNumber,
    );
    anchorSkipped = alreadyAnchoredBase;

    if (!alreadyAnchoredBase) {
      // We need a Base-side anchor — build the parent-chain inputs.
      const baseAnchor = await buildBaseAnchorChainInputsViaCannon(
        externalChainId, externalTxHash,
      );

      // Check whether the L1 block is already on EthLightClient.
      // BaseLightClient.anchorBaseBlockChainViaCannon will revert if
      // the L1 block isn't yet anchored, so this step is required
      // when missing.
      const alreadyAnchoredL1 = await fetchEthLightClientAnchor(
        accessToken, cfg.l1LightClient!, baseAnchor.l1BlockNumber,
      );
      l1AnchorSkipped = !!alreadyAnchoredL1;
      if (!alreadyAnchoredL1) {
        // Same catchup logic on the wrapped L1 EthLightClient.
        const advances = await buildAdvanceCommitteeTxsIfNeeded(
          accessToken,
          beaconChainIdFor(externalChainId, "base"),
          cfg.l1LightClient!,
          baseAnchor.l1Anchor.sync.signatureSlot,
        );
        committeeAdvanceCount = advances.length;
        txInputs.push(...advances);
        txInputs.push({
          contractName: extractContractName(EthLightClientName),
          contractAddress: cfg.l1LightClient!,
          method: "anchorBlockHeader",
          args: buildEthAnchorArgs(baseAnchor.l1Anchor),
        });
      }

      txInputs.push({
        contractName: extractContractName(BaseLightClientName),
        contractAddress: cfg.lightClient,
        method: "anchorBaseBlockChainViaCannon",
        args: buildBaseAnchorArgs(baseAnchor),
      });
    } else {
      // Both anchors already on-chain — record the skip.
      l1AnchorSkipped = true;
    }
  } else {
    // Linea / zk-rollup path. Same overall shape as Base — anchor an
    // L1 block on EthLightClient, then anchor the L2 endBlock + parent
    // walk on LineaLightClient — but the L2-side anchor binds against a
    // DataFinalizedV3 event (no rootClaim reconstruction needed).
    const alreadyAnchoredLinea = await fetchLineaLightClientAnchored(
      accessToken, cfg.lightClient, claim.blockNumber,
    );
    anchorSkipped = alreadyAnchoredLinea;

    if (!alreadyAnchoredLinea) {
      const lineaAnchor = await buildLineaAnchorChainInputs(
        externalChainId, externalTxHash,
      );

      // L1 anchor check.
      const alreadyAnchoredL1 = await fetchEthLightClientAnchor(
        accessToken, cfg.l1LightClient!, lineaAnchor.l1BlockNumber,
      );
      l1AnchorSkipped = !!alreadyAnchoredL1;
      if (!alreadyAnchoredL1) {
        const advances = await buildAdvanceCommitteeTxsIfNeeded(
          accessToken,
          beaconChainIdFor(externalChainId, "linea"),
          cfg.l1LightClient!,
          lineaAnchor.l1Anchor.sync.signatureSlot,
        );
        committeeAdvanceCount = advances.length;
        txInputs.push(...advances);
        txInputs.push({
          contractName: extractContractName(EthLightClientName),
          contractAddress: cfg.l1LightClient!,
          method: "anchorBlockHeader",
          args: buildEthAnchorArgs(lineaAnchor.l1Anchor),
        });
      }

      txInputs.push({
        contractName: extractContractName(LineaLightClientName),
        contractAddress: cfg.lightClient,
        method: "anchorLineaBlockChain",
        args: buildLineaAnchorArgs(lineaAnchor),
      });
    } else {
      l1AnchorSkipped = true;
    }
  }

  // Always: the claim tx.
  txInputs.push({
    contractName: extractContractName(EthBridgeInName),
    contractAddress: cfg.bridgeIn,
    method: "claim",
    args: buildClaimArgs(claim, assignment),
  });

  const tx = await buildFunctionTx(txInputs, userAddress, accessToken);
  const allResults = await postAndWaitForAllTxs(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, tx),
  );
  const hashes = allResults
    .map((r: any) => r?.hash)
    .filter((h: any): h is string => typeof h === "string");
  const externalSigning =
    allResults.length > 0 &&
    allResults[0]?.status === undefined &&
    allResults[0]?.data !== undefined;

  return {
    status: externalSigning ? "unsigned" : allResults[allResults.length - 1]?.status,
    hashes,
    anchorSkipped,
    l1AnchorSkipped,
    committeeAdvanceCount,
    blockNumber: claim.blockNumber,
    flavor: cfg.flavor,
  };
};
