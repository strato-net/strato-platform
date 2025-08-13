import { config } from '../config';
import { execute } from '../utils/stratoHelper';
import {
  getLastProcessedBlock,
  getEnabledChains,
  isTokenEnabled
} from '../services/cirrusService';
import { depositBatch } from '../services/bridgeService';
import {
  getCurrentBlockNumber,
  getChainLogs,
  isChainConfigured
} from '../services/rpcService';
import { logInfo, logError, logChainSync } from '../utils/logger';

// DepositInitiated(uint256,string,address,uint256,address) keccak256 hash
const DEPOSIT_EVENT_SIGNATURE = '0x8f678ca000000000000000000000000000000000000000000000000000000000';

const updateLastProcessedBlock = async (
  chainId: number,
  blockNumber: number
): Promise<void> => {
  try {
    await execute({
      contractName: 'MercataBridge',
      contractAddress: config.bridge.address!,
      method: 'setLastProcessedBlock',
      args: {
        chainId: chainId,
        lastProcessedBlock: blockNumber
      }
    });
  } catch (error) {
    throw error; // Let the caller handle logging
  }
};

const parseDepositEvent = (log: any) => {
  try {
    const srcChainId = parseInt(log.topics[1], 16);
    const srcTxHash = log.data.substring(0, 66);
    const token = '0x' + log.data.substring(66, 106);
    const amount = log.data.substring(106, 170);
    const user = '0x' + log.data.substring(170, 210);

    return {
      srcChainId,
      srcTxHash,
      token,
      amount,
      user
    };
  } catch (error) {
    return null; // Return null for unparseable events
  }
};

const validateDepositEvent = async (depositData: any): Promise<boolean> => {
  try {
    const isTokenValid = await isTokenEnabled(depositData.token);
    return isTokenValid;
  } catch (error) {
    return false; // Return false for validation errors
  }
};

const pollChainForDeposits = async (chain: any) => {
  try {
    const chainId = chain.chainId;
    const depositRouter = chain.depositRouter;

    if (!depositRouter) {
      return; // Skip chains without deposit router
    }

    const lastProcessedBlock = await getLastProcessedBlock(chainId);

    if (!isChainConfigured(chainId)) {
      return; // Skip chains without RPC configuration
    }

    const currentBlock = await getCurrentBlockNumber(chainId);

    if (currentBlock <= lastProcessedBlock) {
      return; // No new blocks to process
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

    // Process deposit events
    const validDeposits: any[] = [];
    for (const log of logs) {
      const depositData = parseDepositEvent(log);
      if (!depositData) {
        continue;
      }

      const isValid = await validateDepositEvent(depositData);
      if (!isValid) {
        continue;
      }

      validDeposits.push(depositData);
    }

    // Batch process valid deposits
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

      if (enabledChains.length === 0) {
        return;
      }

      for (const chain of enabledChains) {
        await pollChainForDeposits(chain);
      }
    } catch (e: any) {
      logError('AlchemyPolling', e as Error, { operation: 'startMultiChainDepositPolling' });
    }
  };

  poll();
  setInterval(poll, pollingInterval);
};
