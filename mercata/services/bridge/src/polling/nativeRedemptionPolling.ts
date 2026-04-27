import { config, getNativeRepresentationBridgeAddress, NATIVE_REDEMPTION_EVENT_SIGNATURE } from "../config";
import { getCurrentBlockNumber, getChainLogs, isChainConfigured } from "../services/rpcService";
import { getEnabledChains } from "../services/cirrusService";
import { recordNativeDepositBatch } from "../services/bridgeService";
import { nativeBlockTrackingService } from "../services/nativeBlockTrackingService";
import { NativeDepositArgs } from "../types";
import { logError, logInfo } from "../utils/logger";

const decodeIndexedAddress = (topic: string): string => `0x${topic.slice(26)}`.toLowerCase();

const decodeNativeRedemptionData = (
  data: string,
): { amount: string; redemptionId: string } => {
  if (!data.startsWith("0x") || data.length < 130) {
    throw new Error(`Invalid log data: ${data}`);
  }

  return {
    amount: BigInt(`0x${data.slice(2, 66)}`).toString(),
    redemptionId: BigInt(`0x${data.slice(66, 130)}`).toString(),
  };
};

const parseNativeDepositLog = (chainId: number, log: any): NativeDepositArgs | null => {
  if (!log.transactionHash || log.topics.length < 4) {
    return null;
  }

  const { amount, redemptionId } = decodeNativeRedemptionData(log.data);

  return {
    externalChainId: chainId,
    externalBridge: log.address.toLowerCase(),
    externalRedemptionId: redemptionId,
    externalSender: decodeIndexedAddress(log.topics[2]),
    representationToken: decodeIndexedAddress(log.topics[1]),
    externalTxHash: log.transactionHash,
    stratoRecipient: decodeIndexedAddress(log.topics[3]),
    stratoTokenAmount: amount,
  };
};

const pollChainNativeRedemptions = async (chainId: number, fallbackLastBlock: number) => {
  const nativeRepresentationBridge = getNativeRepresentationBridgeAddress(chainId);
  if (!nativeRepresentationBridge) {
    return;
  }
  if (!isChainConfigured(chainId)) {
    return;
  }

  const currentBlock = await getCurrentBlockNumber(chainId);
  const effectiveLastProcessedBlock =
    await nativeBlockTrackingService.getEffectiveLastProcessedBlock(
      chainId,
      fallbackLastBlock,
    );

  if (effectiveLastProcessedBlock >= currentBlock) {
    return;
  }

  const logs = await getChainLogs(
    chainId,
    effectiveLastProcessedBlock + 1,
    currentBlock,
    nativeRepresentationBridge,
    NATIVE_REDEMPTION_EVENT_SIGNATURE,
  );

  const deposits = logs
    .map((log) => parseNativeDepositLog(chainId, log))
    .filter((deposit): deposit is NativeDepositArgs => deposit !== null);

  if (deposits.length > 0) {
    await recordNativeDepositBatch([deposits[0], ...deposits.slice(1)]);
    logInfo(
      "NativeRedemptionPolling",
      `Recorded ${deposits.length} native redemption deposits for chain ${chainId}`,
    );
  }

  await nativeBlockTrackingService.updateLastProcessedBlockLocally(chainId, currentBlock);
};

export const startNativeRedemptionPolling = () => {
  const poll = async () => {
    try {
      const enabledChains = Array.from((await getEnabledChains()).values());

      await Promise.all(
        enabledChains.map(async (chainInfo) => {
          if (!chainInfo.externalChainId) {
            return;
          }

          await pollChainNativeRedemptions(
            Number(chainInfo.externalChainId),
            Number(chainInfo.lastProcessedBlock || 0),
          );
        }),
      );
    } catch (error) {
      logError("NativeRedemptionPolling", error as Error, {
        operation: "startNativeRedemptionPolling",
      });
    }
  };

  poll();
  setInterval(poll, config.polling.bridgeInInterval);

  logInfo("NativeRedemptionPolling", "Started native redemption polling");
};
