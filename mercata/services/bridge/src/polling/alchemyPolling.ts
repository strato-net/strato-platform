import { config } from '../config';
import { contractCall } from '../utils/contractCall';
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
} from '../utils/rpcApiHelper';

const DEPOSIT_EVENT_SIGNATURE =
  '0x' +
  'DepositInitiated(uint256,string,address,uint256,address)'
    .split('')
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('');

const updateLastProcessedBlock = async (
  chainId: number,
  blockNumber: number
): Promise<void> => {
  try {
    await contractCall('MercataBridge', config.bridge.address!, 'setLastProcessedBlock', {
      chainId: chainId,
      lastProcessedBlock: blockNumber
    });
    console.log(`✅ Updated last processed block for chain ${chainId} to ${blockNumber}`);
  } catch (error) {
    console.error(`❌ Failed to update last processed block for chain ${chainId}:`, error);
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
    console.error('❌ Failed to parse deposit event:', error);
    return null;
  }
};

const validateDepositEvent = async (depositData: any): Promise<boolean> => {
  try {
    const isTokenValid = await isTokenEnabled(depositData.token);
    if (!isTokenValid) {
      console.log(`❌ Token ${depositData.token} not enabled in bridge`);
      return false;
    }
    return true;
  } catch (error) {
    console.error('❌ Failed to validate deposit event:', error);
    return false;
  }
};

const pollChainForDeposits = async (chain: any) => {
  try {
    const chainId = chain.chainId;
    const depositRouter = chain.depositRouter;

    if (!depositRouter) {
      console.log(`⚠️ No deposit router configured for chain ${chainId}`);
      return;
    }

    console.log(`🔍 Polling chain ${chainId} (${chain.chainName}) for deposit events...`);

    const lastProcessedBlock = await getLastProcessedBlock(chainId);

    if (!isChainConfigured(chainId)) {
      console.log(`⚠️ No RPC URL configured for chain ${chainId}`);
      return;
    }

    const currentBlock = await getCurrentBlockNumber(chainId);

    if (currentBlock <= lastProcessedBlock) {
      console.log(`⏳ No new blocks to process for chain ${chainId}`);
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
      console.log(`📝 No deposit events found for chain ${chainId}`);
      await updateLastProcessedBlock(chainId, currentBlock);
      return;
    }

    console.log(`📝 Found ${logs.length} deposit events for chain ${chainId}`);

    for (const log of logs) {
      try {
        const depositData = parseDepositEvent(log);

        if (!depositData) {
          console.log('❌ Failed to parse deposit event');
          continue;
        }

        const isValid = await validateDepositEvent(depositData);

        if (!isValid) {
          console.log('❌ Deposit event validation failed');
          continue;
        }

        await depositBatch([
          {
            srcChainId: depositData.srcChainId,
            srcTxHash: depositData.srcTxHash,
            token: depositData.token,
            amount: depositData.amount,
            user: depositData.user
          }
        ]);

        console.log(`✅ Deposited: ${depositData.srcTxHash} from chain ${chainId}`);
      } catch (error) {
        console.error('❌ Failed to process deposit event:', error);
      }
    }

    await updateLastProcessedBlock(chainId, currentBlock);
  } catch (error) {
    console.error(`❌ Error polling chain ${chain.chainId}:`, error);
  }
};

export const startMultiChainDepositPolling = async () => {
  const pollingInterval = config.polling.ethereumDepositInterval || 5 * 60 * 1000;
  const poll = async () => {
    try {
      console.log('🔍 Starting multi-chain deposit polling...');
      const enabledChains = await getEnabledChains();

      if (enabledChains.length === 0) {
        console.log('⚠️ No enabled chains found');
        return;
      }

      console.log(`📝 Found ${enabledChains.length} enabled chains to poll`);

      for (const chain of enabledChains) {
        await pollChainForDeposits(chain);
      }
    } catch (e: any) {
      console.error('❌ Multi-chain deposit polling error:', e.message);
    }
  };

  await poll();
  setInterval(poll, pollingInterval);
};
