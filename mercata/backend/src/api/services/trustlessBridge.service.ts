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
  buildClaimInputs,
  AnchorInputs,
  ClaimInputs,
} from "./bridgeProof.service";
import {
  BaseAnchorChainInputs,
  buildBaseAnchorChainInputsViaCannon,
  buildBaseClaimInputs,
} from "./baseProof.service";

const { MercataBridge, mercataBridge } = constants;
const EthBridgeInName    = "BlockApps-EthBridgeIn";
const EthLightClientName = "BlockApps-EthLightClient";
const BaseLightClientName = "BlockApps-BaseLightClient";

/**
 * Tag identifying which on-chain anchor flow a given source chain
 * uses. Drives both the contract dispatch (which method to call) and
 * the proof-builder selection (which off-chain service runs).
 */
type LightClientFlavor = "eth" | "base";

const FLAVOR_BY_CHAIN_ID: Record<string, LightClientFlavor> = {
  "1":        "eth",
  "11155111": "eth",
  "8453":     "base",
  "84532":    "base",
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

  // 3. Base flavor: also fetch BaseLightClient.l1LightClient so we can
  //    submit the L1 anchor tx to the right contract.
  const { data: baseRows } = await cirrus.get(accessToken, `/${BaseLightClientName}`, {
    params: {
      address: `eq.${lightClient.replace(/^0x/, "")}`,
      select: "l1LightClient",
    },
  });
  const baseRow = baseRows?.[0];
  if (!baseRow) throw new Error(`BaseLightClient ${lightClient} not found in cirrus`);
  const l1LightClient = ensureHexPrefix(baseRow.l1LightClient);
  if (!l1LightClient || /^0+$/.test(l1LightClient.replace(/^0x/, ""))) {
    throw new Error("BaseLightClient: l1LightClient unset");
  }

  return { flavor, bridgeIn, lightClient, depositRoutedSig, l1LightClient };
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
// ─────────────────────────────────────────────────────────────────────

const buildEthAnchorArgs = (anchor: AnchorInputs) => ({
  headers: anchor.headers,
  sync: anchor.sync,
  parentChain: anchor.parentChain,
  eph: anchor.eph,
  executionBranch: anchor.executionBranch,
});

const buildBaseAnchorArgs = (b: BaseAnchorChainInputs) => ({
  proof: {
    l1BlockNumber: b.l1BlockNumber,
    txIndex: b.txIndex,
    logIndex: b.logIndex,
    receiptValueBytes: b.receiptValueBytes,
    mptProof: b.mptProof,
  },
  baseHeaderRLP: b.anchorHeaderRLP,
  withdrawalStorageRoot: b.withdrawalStorageRoot,
  parentChain: b.parentChain,
});

const ZERO_BYTES32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000";
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

const buildClaimArgs = (
  claim: ClaimInputs,
  assignment: TrustlessClaimParams["assignment"],
) => ({
  blockNumber: claim.blockNumber,
  txIndex: claim.txIndex,
  logIndex: claim.logIndex,
  receiptValueBytes: claim.receiptValueBytes,
  mptProof: claim.mptProof,
  assignment: assignment ?? {
    depositKey: ZERO_BYTES32,
    newRecipient: ZERO_ADDR,
    deadline: "0",
    v: 0,
    r: ZERO_BYTES32,
    s: ZERO_BYTES32,
  },
});

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
      : await buildClaimInputs(externalChainId, externalTxHash, cfg.depositRoutedSig);

  const txInputs: Array<{ contractName: string; contractAddress: string; method: string; args: Record<string, any> }> = [];
  let l1AnchorSkipped = false;
  let anchorSkipped = false;

  if (cfg.flavor === "eth") {
    // Single-block Eth path: anchor on EthLightClient if needed, claim.
    const alreadyAnchored = await fetchEthLightClientAnchor(
      accessToken, cfg.lightClient, claim.blockNumber,
    );
    anchorSkipped = !!alreadyAnchored;
    if (!alreadyAnchored) {
      const anchor = await buildAnchorInputs(externalChainId, externalTxHash);
      txInputs.push({
        contractName: extractContractName(EthLightClientName),
        contractAddress: cfg.lightClient,
        method: "anchorBlockHeader",
        args: buildEthAnchorArgs(anchor),
      });
    }
  } else {
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
    blockNumber: claim.blockNumber,
    flavor: cfg.flavor,
  };
};
