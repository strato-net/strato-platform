/**
 * Finding bridge transfers this solver could fill.
 *
 * Read entirely from Cirrus, which is the only place the joined picture exists:
 * a deposit's record, its committed fee schedule, any claim already on it, and
 * any post-deposit action intent all live in separate tables keyed the same way.
 * Missing a join is not a cosmetic bug -- filling a deposit that carries an
 * auto-forge intent, or one already claimed, loses the money.
 *
 * NOTHING HERE VERIFIES AN ORIGIN TRANSACTION, because STRATO cannot. A record
 * in state ANNOUNCED is a stranger's bonded claim and may be fiction; one in
 * INITIATED has been posted by the relayer, which did verify it. That
 * distinction is the difference between a priced risk and a donation, so it is
 * surfaced on every candidate rather than flattened away.
 */
import { StratoSolverClient } from "./strato";
import { FeeSchedule } from "./pricing";

/** BridgeTypes.BridgeStatus, as Cirrus renders it. */
export const STATUS = {
  INITIATED: "1",
  PENDING_REVIEW: "2",
  ANNOUNCED: "6",
} as const;

export type Verification = "relayer-posted" | "announced-only";

export interface DepositCandidate {
  kind: "mercata" | "native";
  /** How to address it in a fill call. */
  externalChainId?: string;
  externalTxHash?: string;
  depositId?: string;
  recipient: string;
  token: string;
  amount: bigint;
  schedule: FeeSchedule;
  verification: Verification;
  /** Set when someone already holds the claim. */
  claimant?: string;
  claimTransferable?: boolean;
  claimExitFee?: bigint;
  claimVoided?: boolean;
}

const big = (v: unknown): bigint => {
  if (v === undefined || v === null || v === "") return 0n;
  return BigInt(String(v));
};

const scheduleFrom = (row: any): FeeSchedule | null => {
  if (!row || row.set !== true) return null;
  return {
    maxFee: big(row.maxFee),
    requestedAt: big(row.requestedAt),
    feeHalfLife: big(row.feeHalfLife),
  };
};

const verificationOf = (status: string): Verification =>
  status === STATUS.ANNOUNCED ? "announced-only" : "relayer-posted";

/**
 * MercataBridge deposits, keyed by (externalChainId, externalTxHash).
 *
 * A deposit carrying a non-zero action intent is dropped, not merely
 * deprioritised: a solver cannot reproduce an auto-forge or auto-save, so the
 * claim would be voided at confirm time and the payment lost.
 */
export async function findMercataDeposits(
  client: StratoSolverClient,
  bridge: string,
): Promise<DepositCandidate[]> {
  const statuses = [STATUS.INITIATED, STATUS.PENDING_REVIEW, STATUS.ANNOUNCED];
  const out: DepositCandidate[] = [];

  for (const status of statuses) {
    const deposits = await client.cirrus("BlockApps-MercataBridge-deposits", {
      address: `eq.${bridge}`,
      "value->>bridgeStatus": `eq.${status}`,
      select: "key,key2,value",
    });

    for (const row of deposits) {
      const chainId = String(row.key);
      const txHash = String(row.key2);
      const d = row.value || {};

      const [terms, claims, actions] = await Promise.all([
        client.cirrus("BlockApps-MercataBridge-depositFeeTerms", {
          address: `eq.${bridge}`, key: `eq.${chainId}`, key2: `eq.${txHash}`, select: "value",
        }),
        client.cirrus("BlockApps-MercataBridge-depositClaims", {
          address: `eq.${bridge}`, key: `eq.${chainId}`, key2: `eq.${txHash}`, select: "value",
        }),
        client.cirrus("BlockApps-MercataBridge-depositActions", {
          address: `eq.${bridge}`, key: `eq.${chainId}`, key2: `eq.${txHash}`, select: "value",
        }),
      ]);

      const schedule = scheduleFrom(terms[0]?.value);
      if (!schedule) continue; // pre-upgrade deposit: not fillable

      // An action intent makes the claim unmatchable at confirm time.
      if (big(actions[0]?.value?.action) !== 0n) continue;

      const claim = claims[0]?.value;
      out.push({
        kind: "mercata",
        externalChainId: chainId,
        externalTxHash: txHash,
        recipient: String(d.stratoRecipient || ""),
        token: String(d.stratoToken || ""),
        amount: big(d.stratoTokenAmount),
        schedule,
        verification: verificationOf(status),
        claimant: claim?.claimant || undefined,
        claimTransferable: claim?.transferable === true,
        claimExitFee: claim ? big(claim.exitFee) : undefined,
        claimVoided: claim?.voided === true,
      });
    }
  }

  return out;
}

/** StratoNativeBridge deposits, keyed by depositId. */
export async function findNativeDeposits(
  client: StratoSolverClient,
  bridge: string,
): Promise<DepositCandidate[]> {
  const statuses = [STATUS.INITIATED, STATUS.PENDING_REVIEW, STATUS.ANNOUNCED];
  const out: DepositCandidate[] = [];

  for (const status of statuses) {
    const deposits = await client.cirrus("BlockApps-StratoNativeBridge-deposits", {
      address: `eq.${bridge}`,
      "value->>bridgeStatus": `eq.${status}`,
      select: "key,value",
    });

    for (const row of deposits) {
      const depositId = String(row.key);
      const d = row.value || {};

      const [terms, claims] = await Promise.all([
        client.cirrus("BlockApps-StratoNativeBridge-depositFeeTerms", {
          address: `eq.${bridge}`, key: `eq.${depositId}`, select: "value",
        }),
        client.cirrus("BlockApps-StratoNativeBridge-depositClaims", {
          address: `eq.${bridge}`, key: `eq.${depositId}`, select: "value",
        }),
      ]);

      const schedule = scheduleFrom(terms[0]?.value);
      if (!schedule) continue;

      const claim = claims[0]?.value;
      out.push({
        kind: "native",
        depositId,
        recipient: String(d.stratoRecipient || ""),
        token: String(d.stratoToken || ""),
        amount: big(d.stratoTokenAmount),
        schedule,
        verification: verificationOf(status),
        claimant: claim?.claimant || undefined,
        claimTransferable: claim?.transferable === true,
        claimExitFee: claim ? big(claim.exitFee) : undefined,
        claimVoided: claim?.voided === true,
      });
    }
  }

  return out;
}

/** An ERC-20 balance for this solver, read through bloc state. */
export async function tokenBalance(
  client: StratoSolverClient,
  token: string,
  holder: string,
): Promise<bigint> {
  try {
    const state = await client.readState("ERC20", token);
    const balances = state?.balances ?? state?._balances ?? {};
    // bloc omits zero-valued fields, so an absent holder is a zero balance.
    return big(balances[holder.replace(/^0x/, "").toLowerCase()]);
  } catch {
    return 0n;
  }
}
