import { config, getNativeRepresentationBridgeAddress, NATIVE_REDEMPTION_EVENT_SIGNATURE, NATIVE_ROUTED_REDEMPTION_EVENT_SIGNATURE } from "../config";
import { getCurrentBlockNumber, getChainLogs, isChainConfigured } from "../services/rpcService";
import { getEnabledChains } from "../services/cirrusService";
import { recordNativeDepositBatch } from "../services/bridgeService";
import { nativeBlockTrackingService } from "../services/nativeBlockTrackingService";
import { NativeDepositArgs } from "../types";
import { logError, logInfo } from "../utils/logger";
import { healthMonitor } from "../utils/healthMonitor";

import { parseNativeDepositLog } from "../utils/nativeRedemption";

const pollChainNativeRedemptions = async (chainId: number) => {
  const nativeRepresentationBridge = getNativeRepresentationBridgeAddress(chainId);
  if (!nativeRepresentationBridge) {
    return;
  }
  if (!isChainConfigured(chainId)) {
    return;
  }

  const currentBlock = await getCurrentBlockNumber(chainId);
  const lastProcessedBlock = await nativeBlockTrackingService.getLastProcessedBlock(chainId);

  if (lastProcessedBlock >= currentBlock) {
    return;
  }

  const logs = await getChainLogs(
    chainId,
    lastProcessedBlock + 1,
    currentBlock,
    nativeRepresentationBridge,
    [NATIVE_REDEMPTION_EVENT_SIGNATURE, NATIVE_ROUTED_REDEMPTION_EVENT_SIGNATURE],
  );

  const deposits = logs
    .map((log) => parseNativeDepositLog(chainId, log))
    .filter((deposit): deposit is NativeDepositArgs => deposit !== null);

  if (deposits.length > 0) {
    for (const deposit of deposits) {
      await recordNativeDepositBatch([deposit]);
    }
    logInfo(
      "NativeRedemptionPolling",
      `Recorded ${deposits.length} native redemption deposits for chain ${chainId}`,
    );
  }

  await nativeBlockTrackingService.updateLastProcessedBlockLocally(chainId, currentBlock);
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
