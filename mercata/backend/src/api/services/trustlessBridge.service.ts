/**
 * Trustless bridge-in orchestrator.
 *
 * Fronts the {@link bridgeProof.service} proof builder and packages the
 * resulting AnchorInputs / ClaimInputs into a STRATO transaction batch
 * that the user's wallet signs:
 *
 *   1. EthLightClient.anchorBlockHeader   (only if the block isn't already
 *                                          anchored — saves a tx)
 *   2. EthBridgeIn.claim                  (always)
 *
 * Discovers the EthBridgeIn / EthLightClient deployment addresses via
 * cirrus rather than env vars, so the trustless path picks up a
 * setEthBridgeIn / setLightClient flip without a backend redeploy.
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

const { MercataBridge, mercataBridge } = constants;
const EthBridgeInName = "BlockApps-EthBridgeIn";
const EthLightClientName = "BlockApps-EthLightClient";

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
  /** Set when the block was already anchored on STRATO and we skipped step 1. */
  anchorSkipped: boolean;
  blockNumber: string;
}

/** Extra metadata returned by /bridge/trustlessConfig — handy for the UI. */
export interface TrustlessConfig {
  ethBridgeIn: string;
  lightClient: string;
  depositRoutedSig: string;
}

/**
 * Resolve EthBridgeIn / EthLightClient / depositRoutedSig from on-chain
 * state. Throws if the trustless path isn't configured (MercataBridge
 * still has ethBridgeIn = address(0)).
 */
export const loadTrustlessConfig = async (
  accessToken: string,
): Promise<TrustlessConfig> => {
  // 1. MercataBridge.ethBridgeIn
  const { data: mbRows } = await cirrus.get(accessToken, `/${MercataBridge}`, {
    params: {
      address: `eq.${mercataBridge}`,
      select: "ethBridgeIn",
    },
  });
  const ethBridgeInRaw = mbRows?.[0]?.ethBridgeIn;
  if (!ethBridgeInRaw || /^0+$/.test(ethBridgeInRaw.replace(/^0x/, ""))) {
    throw new Error("MB: trustless path disabled");
  }
  const ethBridgeIn = ensureHexPrefix(ethBridgeInRaw);

  // 2. EthBridgeIn.lightClient + .depositRoutedSig
  const { data: bridgeInRows } = await cirrus.get(accessToken, `/${EthBridgeInName}`, {
    params: {
      address: `eq.${ethBridgeIn.replace(/^0x/, "")}`,
      select: "lightClient,depositRoutedSig",
    },
  });
  const row = bridgeInRows?.[0];
  if (!row) throw new Error(`EthBridgeIn ${ethBridgeIn} not found in cirrus`);
  const lightClient = ensureHexPrefix(row.lightClient);
  const depositRoutedSig = ensureHexPrefix(row.depositRoutedSig);
  if (!lightClient || /^0+$/.test(lightClient.replace(/^0x/, ""))) {
    throw new Error("EthBridgeIn: lightClient unset");
  }
  if (!depositRoutedSig || /^0+$/.test(depositRoutedSig.replace(/^0x/, ""))) {
    throw new Error("EthBridgeIn: depositRoutedSig unset");
  }
  return { ethBridgeIn, lightClient, depositRoutedSig };
};

/**
 * Read EthLightClient.anchored[blockNumber]. Returns the receiptsRoot
 * (zero bytes32 if not anchored). We use this to skip the anchor tx
 * when someone else has already anchored the same block — common when
 * multiple users claim from the same finalized slot.
 */
const fetchAnchoredReceiptsRoot = async (
  accessToken: string,
  lightClient: string,
  blockNumber: string,
): Promise<string | undefined> => {
  const addr = lightClient.replace(/^0x/, "");
  // anchored is a mapping(uint256 => bytes32). Cirrus exposes it as a
  // separate table named `${ContractName}-anchored`.
  try {
    const { data } = await cirrus.get(accessToken, `/${EthLightClientName}-anchored`, {
      params: {
        address: `eq.${addr}`,
        key: `eq.${blockNumber}`,
        select: "value",
      },
    });
    const v = data?.[0]?.value;
    if (!v) return undefined;
    const stripped = String(v).replace(/^0x/, "");
    if (/^0+$/.test(stripped)) return undefined;
    return ensureHexPrefix(v);
  } catch {
    // If the table query fails (e.g. mapping not yet populated) treat as
    // "not anchored" and let the on-chain require() bounce a duplicate.
    return undefined;
  }
};

/**
 * Build the args object for EthLightClient.anchorBlockHeader. The shape
 * mirrors the Solidity struct field order; SolidVM's tx builder will
 * serialize per the contract ABI.
 */
const buildAnchorArgs = (anchor: AnchorInputs) => ({
  headers: anchor.headers,
  sync: anchor.sync,
  parentChain: anchor.parentChain,
  eph: anchor.eph,
  executionBranch: anchor.executionBranch,
});

/**
 * Build the args object for EthBridgeIn.claim. The optional assignment
 * defaults to the all-zero ClaimAssignment that the contract treats as
 * "no redirect".
 */
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
    depositKey:
      "0x0000000000000000000000000000000000000000000000000000000000000000",
    newRecipient: "0x0000000000000000000000000000000000000000",
    deadline: "0",
    v: 0,
    r: "0x0000000000000000000000000000000000000000000000000000000000000000",
    s: "0x0000000000000000000000000000000000000000000000000000000000000000",
  },
});

export const trustlessClaim = async (
  accessToken: string,
  { externalChainId, externalTxHash, assignment }: TrustlessClaimParams,
  userAddress: string,
): Promise<TrustlessClaimResponse> => {
  const cfg = await loadTrustlessConfig(accessToken);

  // Build claim inputs first — they fail loudest if the deposit log
  // can't be located, and there's no point fetching anchor inputs if
  // the user can never claim.
  const claim = await buildClaimInputs(
    externalChainId,
    externalTxHash,
    cfg.depositRoutedSig,
  );

  // Skip the anchor tx when the block is already on-chain. Saves the
  // user a tx + the BLS verification gas; the contract enforces the
  // same invariant via require(receiptsRoot != 0).
  const alreadyAnchored = await fetchAnchoredReceiptsRoot(
    accessToken,
    cfg.lightClient,
    claim.blockNumber,
  );

  let anchor: AnchorInputs | undefined;
  if (!alreadyAnchored) {
    anchor = await buildAnchorInputs(externalChainId, externalTxHash);
  }

  const txInputs = [];
  if (anchor) {
    txInputs.push({
      contractName: extractContractName(EthLightClientName),
      contractAddress: cfg.lightClient,
      method: "anchorBlockHeader",
      args: buildAnchorArgs(anchor),
    });
  }
  txInputs.push({
    contractName: extractContractName(EthBridgeInName),
    contractAddress: cfg.ethBridgeIn,
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
    anchorSkipped: !anchor,
    blockNumber: claim.blockNumber,
  };
};
