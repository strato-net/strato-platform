import { processingIssueService } from "../services/processingIssueService";
import { config, getNativeRepresentationBridgeAddress, getDepositConfirmationPolicy, NATIVE_REDEMPTION_EVENT_SIGNATURE, NATIVE_ROUTED_REDEMPTION_EVENT_SIGNATURE, NATIVE_SCAN_WINDOW_BLOCKS, getDepositReconciliationDepth } from "../config";
import { getVerificationBlockNumber, getVerifiedNativeLogs, getVerifiedBlockHash, isChainConfigured } from "../services/rpcService";
import { getNativeRedemptionChainIds, getRecordedNativeRedemptions } from "../services/cirrusService";
import { recordNativeDepositBatch } from "../services/bridgeService";
import { nativeBlockTrackingService } from "../services/nativeBlockTrackingService";
import { NativeDepositInfo, NativePendingRedemption, NativeScanCheckpoint } from "../types";
import { logError, logInfo } from "../utils/logger";
import { healthMonitor } from "../utils/healthMonitor";

import { ensureHexPrefix } from "../utils/utils";
import { matchesNativeDeposit, parseNativeDepositLog } from "../utils/nativeRedemption";

export const pollChainNativeRedemptions = async (chainId: number) => {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error("Invalid native scan chain ID");
  const configuredBridge = getNativeRepresentationBridgeAddress(chainId);
  if (!configuredBridge || !/^(0x)?[0-9a-f]{40}$/i.test(configuredBridge) || /^(0x)?0{40}$/i.test(configuredBridge)) {
    throw new Error(`Native representation bridge is not configured for redemption chain ${chainId}`);
  }
  if (!isChainConfigured(chainId)) throw new Error(`RPC is not configured for native redemption chain ${chainId}`);
  const bridge = ensureHexPrefix(configuredBridge).toLowerCase();
  const depth = getDepositReconciliationDepth();
  if (!Number.isSafeInteger(depth) || depth < 1 || depth >= NATIVE_SCAN_WINDOW_BLOCKS) throw new Error("Invalid native scan overlap");
  const head = Math.max(0, await getVerificationBlockNumber(chainId) - getDepositConfirmationPolicy(chainId));
  const saved = await nativeBlockTrackingService.getCheckpoint(chainId);
  if (saved.block > head) {
    throw new Error(`Native checkpoint ${saved.block} is ahead of confirmed head ${head} for chain ${chainId}`);
  }
  const reset = (saved.bridge && saved.bridge !== bridge) ||
    (saved.hash && await getVerifiedBlockHash(chainId, saved.block) !== saved.hash);
  // A checkpoint mismatch can be deeper than the overlap: replay from genesis.
  const state = reset ? { block: 0, reconciliationBlock: 0 } : saved;
  const identity = (pending: NativePendingRedemption) =>
    `${pending.deposit.externalBridge.toLowerCase()}:${pending.deposit.externalRedemptionId}`;
  const now = Date.now();
  const pending = new Map((saved.pendingRedemptions || []).map(entry => [identity(entry), {
    ...entry, observedAt: entry.observedAt ?? now,
  }]));
  let checkpoint: NativeScanCheckpoint = { ...saved, ...state, confirmedHead: head,
    hash: reset ? undefined : saved.hash, bridge,
    forwardProgressAt: saved.forwardProgressAt ?? now, auditProgressAt: saved.auditProgressAt ?? now };
  const failures: unknown[] = [];
  const commit = async (progress: Partial<NativeScanCheckpoint>) => {
    const next = { ...checkpoint, ...progress, pendingRedemptions: [...pending.values()] };
    await nativeBlockTrackingService.saveCheckpoint(chainId, next);
    checkpoint = next;
  };
  const from = Math.max(0, state.block - depth + 1);
  const to = Math.min(head, from + NATIVE_SCAN_WINDOW_BLOCKS - 1);
  const scan = async (start: number, end: number) => {
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
    const redemptions: NativePendingRedemption[] = [];
    for (const log of logs) {
      const deposit = parseNativeDepositLog(chainId, log);
      if (!deposit) continue;
      const entry = { deposit, block: Number(BigInt(log.blockNumber)), blockHash: log.blockHash.toLowerCase() };
      redemptions.push(entry);
    }
    if (before !== await getVerifiedBlockHash(chainId, end)) throw new Error("Native scan reorg before checkpoint");
    return { hash: before, redemptions };
  };
  const retain = (entries: NativePendingRedemption[]) => {
    for (const entry of entries) pending.set(identity(entry), {
      ...entry, observedAt: pending.get(identity(entry))?.observedAt ?? now,
    });
  };
  const runScan = async (name: string, action: () => Promise<void>) => {
    const check = `${name}:${chainId}`;
    if (!healthMonitor.beginPoll(check, config.polling.bridgeInInterval)) {
      failures.push(new Error(`Native scan is already running: ${check}`));
      return;
    }
    try { await action(); }
    catch (error) { healthMonitor.failPoll(check); failures.push(error); }
    finally { healthMonitor.finishPoll(check); }
  };
  if (!config.nativeBridge.address) throw new Error("Native bridge address not configured");
  let forward: Awaited<ReturnType<typeof scan>> | undefined;
  await runScan("nativeRedemptionForward", async () => {
    const result = await scan(from, to);
    retain(result.redemptions);
    await commit({ block: to, hash: result.hash, bridge,
      forwardProgressAt: to !== checkpoint.block || result.hash !== checkpoint.hash ? now : checkpoint.forwardProgressAt });
    forward = result;
  });
  // Independently sweep old history so omissions outside the overlap remain recoverable.
  const auditFrom = checkpoint.reconciliationBlock > checkpoint.block ? 0 : checkpoint.reconciliationBlock;
  const auditTo = Math.min(checkpoint.block, auditFrom + NATIVE_SCAN_WINDOW_BLOCKS - 1);
  await runScan("nativeRedemptionAudit", async () => {
    const result = forward && auditFrom >= from && auditTo <= to ? forward : await scan(auditFrom, auditTo);
    retain(result.redemptions);
    await commit({ reconciliationBlock: auditTo >= checkpoint.block ? 0 : auditTo + 1, auditProgressAt: now });
  });
  let pendingChanged = false;
  for (const externalBridge of new Set([...pending.values()].map(entry => entry.deposit.externalBridge))) {
    const entries = [...pending.values()].filter(entry => entry.deposit.externalBridge === externalBridge);
    let known: NativeDepositInfo[];
    try { known = await getRecordedNativeRedemptions(chainId, externalBridge, entries.map(entry => String(entry.deposit.externalRedemptionId))); }
    catch (error) { failures.push(error); continue; }
    for (const entry of entries) {
      const { deposit } = entry;
      const context = { source: "native" as const, chainId: String(chainId), bridge: config.nativeBridge.address,
        reference: `${deposit.externalBridge}:${deposit.externalRedemptionId}`, stage: "deposit-recording", token: deposit.representationToken };
      const existing = known.find(d => String(d.externalRedemptionId) === String(deposit.externalRedemptionId));
      const recorded = await processingIssueService.run(context, async () => {
        if (entry.block > head || await getVerifiedBlockHash(chainId, entry.block) !== entry.blockHash) {
          throw new Error("Native pending redemption is not confirmed canonical evidence");
        }
        if (existing) {
          // A reused identity with different evidence needs investigation, never another payout.
          if (!matchesNativeDeposit(deposit, existing)) throw new Error("Native redemption identity has conflicting recorded evidence");
          return;
        }
        await recordNativeDepositBatch([deposit]);
      }, !!existing);
      if (recorded) { pending.delete(identity(entry)); pendingChanged = true; }
    }
  }
  try { if (pendingChanged) await commit({}); }
  catch (error) { failures.push(error); }
  if (failures.length) throw failures[0];
};

export const startNativeRedemptionPolling = () => {
  const poll = async () => {
    if (!healthMonitor.beginPoll("nativeRedemptions", config.polling.bridgeInInterval)) return;
    try {
      const [routeChains, journalChains] = await Promise.all([
        getNativeRedemptionChainIds(), nativeBlockTrackingService.getChainIds(),
      ]);
      const chainIds = [...new Set([...routeChains, ...journalChains])];
      const results = await Promise.allSettled(
        chainIds.map(pollChainNativeRedemptions),
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
