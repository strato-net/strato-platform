import { config } from "../config";
import { execute } from "../utils/stratoHelper";
import {
  getLastProcessedBlock,
  getEnabledChains,
  getEnabledAssets,
} from "../services/cirrusService";
import { depositBatch } from "../services/bridgeService";
import { NonEmptyArray } from "../types";
import {
  getCurrentBlockNumber,
  getChainLogs,
  isChainConfigured,
} from "../services/rpcService";
import { logError } from "../utils/logger";
import {
  convertToStratoDecimals,
  normalizeAddress,
  ensureHexPrefix,
} from "../utils/utils";
import { STRATO_DECIMALS } from "../config";

// DepositInitiated(uint256,string,address,uint256,address) keccak256 hash
import { DEPOSIT_EVENT_SIGNATURE } from "../config";

const getStratoTokenMapping = async (
  chainId: number,
): Promise<Map<string, { stratoToken: string; extDecimals: number }>> => {
  const enabledAssets = await getEnabledAssets();
  const mapping = new Map<
    string,
    { stratoToken: string; extDecimals: number }
  >();

  for (const asset of enabledAssets) {
    if (asset.chainId === chainId.toString() && asset.extToken) {
      const extTokenWith0x = ensureHexPrefix(asset.extToken);
      mapping.set(extTokenWith0x.toLowerCase(), {
        stratoToken: asset.stratoToken,
        extDecimals: parseInt(asset.extDecimals) || STRATO_DECIMALS,
      });
    }
  }

  return mapping;
};

const updateLastProcessedBlock = async (
  chainId: number,
  blockNumber: number,
): Promise<void> => {
  await execute({
    contractName: "MercataBridge",
    contractAddress: config.bridge.address!,
    method: "setLastProcessedBlock",
    args: {
      chainId: chainId,
      lastProcessedBlock: blockNumber,
    },
  });
};

const parseDepositEvents = async (logs: any[], chainId: number) => {
  const tokenMapping = await getStratoTokenMapping(chainId);
  return logs.map((log) => {
    const externalToken = normalizeAddress(log.topics[1]);
    const stratoAddress = normalizeAddress(log.topics[3]);
    const amount = "0x" + log.data.substring(2, 66);

    const tokenInfo = tokenMapping.get(externalToken);
    if (!tokenInfo) {
      return null;
    }

    // Convert amount from external decimals to STRATO decimals
    const convertedAmount = convertToStratoDecimals(
      amount,
      tokenInfo.extDecimals,
    );

    return {
      srcChainId: chainId,
      srcTxHash: log.transactionHash,
      token: tokenInfo.stratoToken,
      amount: convertedAmount,
      user: stratoAddress,
    };
  });
};

const pollChainForDeposits = async (chain: any) => {
  try {
    const chainId = chain.chainId;
    const depositRouter = chain.depositRouter;

    const lastProcessedBlock = await getLastProcessedBlock(chainId);
    if (!isChainConfigured(chainId)) return;

    const currentBlock = await getCurrentBlockNumber(chainId);
    if (currentBlock <= lastProcessedBlock) {
      return;
    }

    const logs = await getChainLogs(
      chainId,
      lastProcessedBlock + 1,
      currentBlock,
      depositRouter,
      DEPOSIT_EVENT_SIGNATURE,
    );

    if (logs.length === 0) {
      await updateLastProcessedBlock(chainId, currentBlock);
      return;
    }

    const validDeposits = await parseDepositEvents(logs, chainId);

    const filteredDeposits = validDeposits.filter(
      (deposit) => deposit !== null,
    );
    const failedParses = validDeposits.length - filteredDeposits.length;

    if (failedParses > 0) {
      return;
    }

    if (filteredDeposits.length > 0) {
      await depositBatch(filteredDeposits as NonEmptyArray<any>);
    }

    await updateLastProcessedBlock(chainId, currentBlock);
  } catch (error) {
    logError("AlchemyPolling", error as Error, {
      operation: "pollChainForDeposits",
      chain,
    });
  }
};

export const startMultiChainDepositPolling = () => {
  const pollingInterval = config.polling.bridgeInInterval || 100 * 1000;

  const poll = async () => {
    try {
      const enabledChains = await getEnabledChains();
      if (enabledChains.length === 0) return;

      await Promise.all(enabledChains.map(pollChainForDeposits));
    } catch (e: any) {
      logError("AlchemyPolling", e as Error, {
        operation: "startMultiChainDepositPolling",
      });
    }
  };

  poll();
  setInterval(poll, pollingInterval);
};
