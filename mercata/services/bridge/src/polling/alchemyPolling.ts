import { config } from '../config';
import { execute } from '../utils/stratoHelper';
import {
  getLastProcessedBlock,
  getEnabledChains
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

const parseDepositEvent = (log: any, chainId: number) => {
  try {
    const token = log.topics[1];
    const stratoAddress = log.topics[3];
    const amount = log.data.substring(0, 66);

    return {
      srcChainId: chainId,
      srcTxHash: log.transactionHash,
      token,
      amount,
      user: stratoAddress
    };
  } catch (error) {
    return null;
  }
};

const pollChainForDeposits = async (chain: any) => {
  try {
    const chainId = chain.chainId;
    const depositRouter = chain.depositRouter;

    if (!depositRouter) return;

    const lastProcessedBlock = await getLastProcessedBlock(chainId);
    if (!isChainConfigured(chainId)) return;

    const currentBlock = await getCurrentBlockNumber(chainId);
    if (currentBlock <= lastProcessedBlock) return;

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

    const validDeposits = logs
      .map(log => parseDepositEvent(log, chainId))
      .filter((depositData, index) => {
        if (!depositData) {
          logError('AlchemyPolling', new Error('Failed to parse deposit event'), { 
            operation: 'parseDepositEvent', 
            chainId, 
            txHash: logs[index].transactionHash,
            log: logs[index]
          });
        }
        return depositData;
      });

    if (validDeposits.length > 0) {
      await depositBatch(validDeposits);
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
