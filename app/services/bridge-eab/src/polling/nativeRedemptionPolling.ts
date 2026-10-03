import { processingIssueService } from "../services/processingIssueService";
import { config, getNativeRepresentationBridgeAddress, getDepositConfirmationPolicy, NATIVE_REDEMPTION_EVENT_SIGNATURE, NATIVE_ROUTED_REDEMPTION_EVENT_SIGNATURE, NATIVE_SCAN_WINDOW_BLOCKS, getDepositReconciliationDepth } from "../config";
import { getVerificationBlockNumber, getVerifiedNativeLogs, getVerifiedBlockHash, isChainConfigured } from "../services/rpcService";
import { getEnabledChains, getRecordedNativeRedemptions } from "../services/cirrusService";
import { recordNativeDepositBatch } from "../services/bridgeService";
import { nativeBlockTrackingService } from "../services/nativeBlockTrackingService";
import { NativeDepositArgs } from "../types";
import { logError, logInfo } from "../utils/logger";
import { healthMonitor } from "../utils/healthMonitor";

import { ensureHexPrefix } from "../utils/utils";
import { parseNativeDepositLog } from "../utils/nativeRedemption";

export const pollChainNativeRedemptions = async (chainId: number) => {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error("Invalid native scan chain ID");
  const configuredBridge = getNativeRepresentationBridgeAddress(chainId);
  if (!configuredBridge || !isChainConfigured(chainId)) return;
  const bridge = ensureHexPrefix(configuredBridge).toLowerCase();
  const depth = getDepositReconciliationDepth();
  if (!Number.isSafeInteger(depth) || depth < 1 || depth >= NATIVE_SCAN_WINDOW_BLOCKS) throw new Error("Invalid native scan overlap");
  const head = Math.max(0, await getVerificationBlockNumber(chainId) - getDepositConfirmationPolicy(chainId));
  const saved = await nativeBlockTrackingService.getCheckpoint(chainId);
  const reset = (saved.bridge && saved.bridge !== bridge) || saved.block > head ||
    (saved.hash && await getVerifiedBlockHash(chainId, saved.block) !== saved.hash);
  // A checkpoint mismatch can be deeper than the overlap: replay from genesis.
  const state = reset ? { block: 0, reconciliationBlock: 0 } : saved;
  const from = Math.max(0, state.block - depth + 1);
  const to = Math.min(head, from + NATIVE_SCAN_WINDOW_BLOCKS - 1);
  const scan = async (start: number, end: number): Promise<string | undefined> => {
    const before = await getVerifiedBlockHash(chainId, end);
    const logs = await getVerifiedNativeLogs(chainId, start, end, bridge,
      [NATIVE_REDEMPTION_EVENT_SIGNATURE, NATIVE_ROUTED_REDEMPTION_EVENT_SIGNATURE]);
    const blocks = new Map<number, string>();
    for (const log of logs) {
      const block = Number(BigInt(log.blockNumber));
      if (!blocks.has(block)) blocks.set(block, await getVerifiedBlockHash(chainId, block));
      if (blocks.get(block) !== log.blockHash.toLowerCase()) throw new Error("Native scan log is not canonical");
    }
    if (before !== await getVerifiedBlockHash(chainId, end)) throw new Error("Native scan reorg during log read");
    const deposits = logs.map(log => parseNativeDepositLog(chainId, log)).filter((d): d is NativeDepositArgs => d !== null);
    const known = await getRecordedNativeRedemptions(chainId, bridge, deposits.map(d => String(d.externalRedemptionId)));
    let recordedAll = true;
    for (const deposit of deposits) {
      const context = { source: "native" as const, chainId: String(chainId), bridge: config.nativeBridge.address!,
        reference: `${deposit.externalBridge}:${deposit.externalRedemptionId}`, stage: "deposit-recording", token: deposit.representationToken };
      const existing = known.find(d => String(d.externalRedemptionId) === String(deposit.externalRedemptionId));
      if (existing) {
        // A reused identity with different evidence needs investigation, never another payout.
        const textFields = ["externalTxHash", "externalSender", "representationToken", "stratoRecipient", "actionToken"] as const;
        const uintFields = ["stratoTokenAmount", "minFinalOut"] as const;
        if (textFields.some(key => String(existing[key] ?? (key === "actionToken" ? "0".repeat(40) : "")).toLowerCase().replace(/^0x/, "") !== String(deposit[key]).toLowerCase().replace(/^0x/, "")) ||
          uintFields.some(key => BigInt(String(existing[key] || "0")) !== BigInt(String(deposit[key] || "0")))) {
          throw new Error("Native redemption identity has conflicting recorded evidence");
        }
        await processingIssueService.resolve(context);
        continue;
      }
      const recorded = await processingIssueService.run(context, () => recordNativeDepositBatch([deposit]));
      if (!recorded) recordedAll = false;
    }
    if (!recordedAll) return undefined;
    if (before !== await getVerifiedBlockHash(chainId, end)) throw new Error("Native scan reorg before checkpoint");
    return before;
  };
  if (!config.nativeBridge.address) throw new Error("Native bridge address not configured");
  const hash = await scan(from, to);
  if (!hash) return;
  // Independently sweep old history so omissions outside the overlap remain recoverable.
  const auditFrom = state.reconciliationBlock > to ? 0 : state.reconciliationBlock;
  const auditTo = Math.min(to, auditFrom + NATIVE_SCAN_WINDOW_BLOCKS - 1);
  const auditHash = auditFrom >= from && auditTo <= to ? hash : await scan(auditFrom, auditTo);
  if (!auditHash) return;
  if (hash !== await getVerifiedBlockHash(chainId, to)) throw new Error("Native scan reorg before checkpoint");
  await nativeBlockTrackingService.saveCheckpoint(chainId, { block: to, hash, bridge,
    reconciliationBlock: auditTo >= to ? 0 : auditTo + 1 });
};

export const startNativeRedemptionPolling = () => {
  const poll = async () => {
    if (!healthMonitor.beginPoll("nativeRedemptions", config.polling.bridgeInInterval)) return;
    try {
      const enabledChains = Array.from((await getEnabledChains()).values());

      const results = await Promise.allSettled(
        enabledChains.map(async (chainInfo) => {
          if (!chainInfo.externalChainId) {
            return;
          }

          await pollChainNativeRedemptions(Number(chainInfo.externalChainId));
        }),
      );
      const failed = results.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
    } catch (error) {
      healthMonitor.failPoll("nativeRedemptions");
      logError("NativeRedemptionPolling", error as Error, {
        operation: "startNativeRedemptionPolling",
      });
    } finally {
      healthMonitor.finishPoll("nativeRedemptions");
    }
  };

  const run = async () => {
    await poll();
    setTimeout(run, config.polling.bridgeInInterval);
  };

  void run();

  logInfo("NativeRedemptionPolling", "Started native redemption polling");
};
