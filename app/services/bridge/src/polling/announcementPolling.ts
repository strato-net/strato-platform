import { config } from "../config";
import { getAnnouncedDeposits } from "../services/cirrusService";
import { rejectAnnouncedDeposit } from "../services/bridgeService";
import { verifyDepositsBatch } from "../services/verificationService";
import { getTransactionReceiptsBatch } from "../services/rpcService";
import { DepositInfo } from "../types";
import { logError, logInfo } from "../utils/logger";

/**
 * The relayer as confirmation bot.
 *
 * An announced deposit is a stranger's unverified claim, posted against a bond
 * so that solvers can act before the relayer has seen the origin transaction.
 * The bridge can never mint from one -- only the relayer's own deposit record
 * moves it to INITIATED -- so an announcement costs the bridge nothing even if
 * it is a complete fabrication. What it can do is mislead a careless solver,
 * which is what the bond is for.
 *
 * This poll does the one thing that needs doing on chain: slash the bond of an
 * announcement that is PROVABLY fake. Everything else resolves itself --
 * a true announcement has its bond returned when the relayer's own record
 * adopts it, and one the relayer never gets to is reclaimable by its author
 * after the TTL.
 *
 * FAIL QUIET, NOT SLASH. Slashing is irreversible and takes a stranger's money,
 * so it requires positive evidence of a lie: a receipt that exists and does not
 * contain the claimed deposit. An RPC that is down, a receipt that has not
 * propagated, a chain that is behind -- none of those are evidence of anything,
 * and all of them leave the announcement alone.
 */

const POLL_BATCH_SIZE = 10;

const chunk = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

/**
 * Whether the claimed origin transaction exists at all.
 *
 * A missing receipt is the ambiguous case -- unpropagated, reorged, or never
 * real -- and it is left alone. Only a deposit whose transaction DID land and
 * whose contents contradict the announcement is treated as a lie.
 */
const receiptLanded = async (deposit: DepositInfo): Promise<boolean> => {
  const receipts = await getTransactionReceiptsBatch(
    Number(deposit.externalChainId),
    [deposit.externalTxHash],
  );
  const receipt = receipts.get(deposit.externalTxHash);
  return Boolean(receipt && receipt.status === "0x1");
};

const reviewAnnouncements = async (announced: DepositInfo[]) => {
  // verifyDepositsBatch is the same check a relayer-recorded deposit gets
  // before it is confirmed: it matches the claimed transfer against the
  // receipt's own logs. Reusing it means an announcement is judged by exactly
  // the standard a real deposit is.
  const failures = await verifyDepositsBatch(announced);

  for (const deposit of announced) {
    const failure = failures.get(deposit.externalTxHash);
    if (!failure) continue;

    let landed = false;
    try {
      landed = await receiptLanded(deposit);
    } catch (error) {
      logError("AnnouncementPolling", error as Error, {
        operation: "receiptLanded",
        externalTxHash: deposit.externalTxHash,
      });
      continue;
    }

    if (!landed) {
      // No receipt: could be anything, including a deposit that simply has not
      // propagated here yet. Not evidence. The announcer's bond becomes
      // reclaimable on its own once the TTL runs.
      continue;
    }

    logInfo(
      "AnnouncementPolling",
      `Announcement ${deposit.externalTxHash} contradicted by its own receipt: ${failure.message}`,
    );
    await rejectAnnouncedDeposit(deposit.externalChainId, deposit.externalTxHash);
  }
};

export const startAnnouncementPolling = (): void => {
  const interval = config.polling.bridgeInInterval ?? 60_000;

  const poll = async () => {
    try {
      const announced = await getAnnouncedDeposits();
      if (announced.length === 0) return;

      for (const batch of chunk(announced, POLL_BATCH_SIZE)) {
        await reviewAnnouncements(batch);
      }
    } catch (error) {
      logError("AnnouncementPolling", error as Error, {
        operation: "startAnnouncementPolling",
      });
    }
  };

  const run = async () => {
    await poll();
    setTimeout(run, interval);
  };

  void run();
  logInfo("AnnouncementPolling", "Started announcement review");
};
