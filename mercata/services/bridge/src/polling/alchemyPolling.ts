import { config } from '../config';
import { execute } from '../utils/stratoHelper';
import {
  getLastProcessedBlock,
  getEnabledChains,
  getEnabledAssets
} from '../services/cirrusService';
import { depositBatch } from '../services/bridgeService';
import {
  getCurrentBlockNumber,
  getChainLogs,
  isChainConfigured
} from '../services/rpcService';
import { logError } from '../utils/logger';

// DepositInitiated(uint256,string,address,uint256,address) keccak256 hash
import { DEPOSIT_EVENT_SIGNATURE } from "../config";

const getStratoTokenMapping = async (chainId: number): Promise<Map<string, string>> => {
  const enabledAssets = await getEnabledAssets();
  const mapping = new Map<string, string>();
  
  for (const asset of enabledAssets) {
    if (asset.chainId === chainId.toString() && asset.extToken) {
      const extTokenWith0x = asset.extToken.startsWith('0x') ? asset.extToken : `0x${asset.extToken}`;
      mapping.set(extTokenWith0x.toLowerCase(), asset.stratoToken);
    }
  }
  
  return mapping;
};

const updateLastProcessedBlock = async (
  chainId: number,
  blockNumber: number
): Promise<void> => {
  await execute({
    contractName: 'MercataBridge',
    contractAddress: config.bridge.address!,
    method: 'setLastProcessedBlock',
    args: {
      chainId: chainId,
      lastProcessedBlock: blockNumber
    }
  });
};

  const parseDepositEvents = async (logs: any[], chainId: number) => {
    const tokenMapping = await getStratoTokenMapping(chainId);
    return logs.map(log => {
      const externalToken = log.topics[1];
      const stratoAddress = log.topics[3];
      const amount = log.data.substring(0, 66);

      // Convert 32-byte padded address to 20-byte standard address
      const normalizedToken = '0x' + externalToken.toLowerCase().slice(-40);
      const stratoToken = tokenMapping.get(normalizedToken);
      if (!stratoToken) {
        return null;
      }
    return {
      srcChainId: chainId,
      srcTxHash: log.transactionHash,
      token: stratoToken,
      amount,
      user: stratoAddress
    };
  });
};

const pollChainForDeposits = async (chain: any) => {
  try {
    const chainId = chain.chainId;
    const depositRouter = chain.depositRouter;

    if (!depositRouter) return;

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
      DEPOSIT_EVENT_SIGNATURE
    );

    if (logs.length === 0) {
      await updateLastProcessedBlock(chainId, currentBlock);
      return;
    }

    const validDeposits = await parseDepositEvents(logs, chainId);
    
    const filteredDeposits = validDeposits.filter(deposit => deposit !== null);
    const failedParses = validDeposits.length - filteredDeposits.length;

    if (failedParses > 0) {
      return;
    }

    if (filteredDeposits.length > 0) {
      await depositBatch(filteredDeposits);
    }

    await updateLastProcessedBlock(chainId, currentBlock);
  } catch (error) {
    logError('AlchemyPolling', error as Error, { operation: 'pollChainForDeposits', chain });
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
      logError('AlchemyPolling', e as Error, { operation: 'startMultiChainDepositPolling' });
    }
  };

  poll();
  setInterval(poll, pollingInterval);
};
