/**
 * Anchoring worker.
 *
 * A deposit can only be claimed once the block holding it is anchored on
 * EthLightClient, and anchoring is the expensive half: it needs a
 * sync-committee aggregate, which costs millions of gas to derive on-chain.
 * This service anchors deposit blocks ahead of anyone claiming them, paying
 * for the aggregate with a SNARK instead.
 *
 * That makes an anchor a public good. One anchor serves every deposit in its
 * block, and a user's claim collapses to a single EthBridgeIn.claim with no
 * anchor, no proof and no committee catch-up in their batch.
 *
 * The split of responsibilities:
 *   - the app backend builds the inclusion-proof material (beacon state
 *     proofs, SSZ branches) and knows nothing about proving;
 *   - proverd turns a committee and a bitfield into a SNARK, holds no keys,
 *     and is not trusted;
 *   - this service stitches them together and is the only party that signs.
 *
 * Nothing here is trusted either. The aggregate is public input to the proof,
 * and EthLightClient still puts it through the BLS pairing against the real
 * signature -- so the worst a broken anchorer can do is fail to anchor, which
 * leaves users to anchor for themselves as they did before.
 */

import { backend } from "../utils/api";
import { execute } from "../utils/stratoHelper";
import { logInfo, logError } from "../utils/logger";
import { proverConfigured, proveAggregate } from "./proverService";
import { chunkBytes32 } from "../utils/hexChunks";

export interface AnchorPlan {
  alreadyAnchored: boolean;
  lightClient: string;
  period?: string;
  signatureSlot?: string;
  participationBits?: string;
  committeePubkeys?: string[];
  advanceTxs?: FunctionTx[];
  anchorTx?: FunctionTx;
}

interface FunctionTx {
  contractName: string;
  contractAddress: string;
  method: string;
  args: Record<string, any>;
}

/** Blocks anchored (or found already anchored) this process lifetime, so a
 *  deposit seen on every poll is not re-anchored every poll. Bounded by the
 *  number of deposit blocks seen, which is small. */
const handled = new Set<string>();

/** bloc wants `bytes` as raw base16. */
const strip0x = (h: string): string => h.replace(/^0x/, "");

/** bloc wants `uint256` as a decimal string; the prover emits hex. */
const toDecimalString = (v: string): string => BigInt(v).toString();

const key = (chainId: string, txHash: string) => `${chainId}:${txHash}`;

/**
 * Anchor the block holding `txHash`, if it is not anchored already.
 *
 * Returns true when the block ends up anchored -- including when it already
 * was. Errors are logged and swallowed: a deposit that cannot be anchored yet
 * (not finalized, light client behind) is a normal state that resolves on a
 * later poll, and one bad deposit must not stall the others.
 */
export const anchorDepositBlock = async (
  chainId: string,
  txHash: string,
): Promise<boolean> => {
  const k = key(chainId, txHash);
  if (handled.has(k)) return true;

  try {
    const { data } = await backend.get<{ success: boolean; data: AnchorPlan }>(
      `/bridge/anchorPlan/${chainId}/${txHash}`,
    );
    const plan = data;

    if (plan.alreadyAnchored) {
      handled.add(k);
      return true;
    }
    if (!plan.anchorTx || !plan.committeePubkeys || !plan.participationBits || !plan.period) {
      logError("AnchorService", new Error("anchor plan is incomplete"), { chainId, txHash });
      return false;
    }

    const txs: FunctionTx[] = [...(plan.advanceTxs ?? [])];

    // The proof is optional. Without it the anchor still works -- it just
    // derives the aggregate on-chain, which fits the gas budget only when
    // participation is high. Better a dear anchor than none.
    if (proverConfigured()) {
      try {
        const proof = await proveAggregate(plan.committeePubkeys, plan.participationBits);
        txs.push({
          contractName: plan.anchorTx.contractName,
          contractAddress: plan.lightClient,
          method: "submitAggregateProof",
          args: {
            period: plan.period,
            participationBits: chunkBytes32(plan.participationBits, 2),
            // bloc does not coerce these. `bytes` wants raw base16 with no 0x,
            // and `uint256[]` wants decimal -- the prover speaks hex for both,
            // so an unconverted arg is rejected at submission.
            claimedAggregate: strip0x(proof.aggregate),
            proof: proof.proof.map(toDecimalString),
          },
        });
      } catch (e) {
        logError("AnchorService", e as Error, {
          operation: "proveAggregate",
          note: "anchoring without a proof; the aggregate will be derived on-chain",
          chainId,
          txHash,
        });
      }
    }

    txs.push(plan.anchorTx);
    logInfo("AnchorService", `anchoring ${chainId}:${txHash} (${txs.length} tx)`);

    // One execute() per tx, NOT one batch.
    //
    // Only the first tx in a batch decodes struct arguments correctly. bloc
    // resolves a struct's field types from the CodeCollection, and for later
    // txs in the same batch it is not available, so argValueToValue falls back
    // to INFERRING field types. The bytes32[2] nested in SyncAggregateInput
    // then arrives as strings and the anchor fails with the badly misleading
    // "BLSVerify: expected 64-byte bitfield". Batched, the anchor tx sits
    // after submitAggregateProof and always loses.
    for (const tx of txs) {
      await execute(tx as any);
    }
    handled.add(k);
    return true;
  } catch (e: any) {
    // 425 = not finalized yet, 409 = too old / light client far behind. Both
    // are states, not faults.
    const status = e?.response?.status;
    if (status === 425 || status === 409) {
      logInfo("AnchorService", `${chainId}:${txHash} not anchorable yet (${status})`);
      return false;
    }
    logError("AnchorService", e as Error, { operation: "anchorDepositBlock", chainId, txHash });
    return false;
  }
};

/** Test seam: forget what has been anchored. */
export const resetAnchorCache = () => handled.clear();

export default { anchorDepositBlock, resetAnchorCache };
