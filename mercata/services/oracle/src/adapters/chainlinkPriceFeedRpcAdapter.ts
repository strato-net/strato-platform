import { ethers } from 'ethers';
import { BatchPriceResult } from '../types';
import { logError, logInfo } from '../utils/logger';

// Minimal ABI for Chainlink feeds
const CHAINLINK_ABI = [
    'function decimals() view returns (uint8)',
    'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)'
];

export async function fetchChainlinkPrices(assets: string[]): Promise<BatchPriceResult> {
    const rpcUrl = process.env.RPC_URL;
    if (!rpcUrl) {
        throw new Error('RPC_URL environment variable not set');
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl, 1); // chainId 1 = Ethereum mainnet
    const result: BatchPriceResult = {};

    const fetchPromises = assets.map(async (assetKey) => {
        const feedAddress = '0xf4e1b57fb228879d057ac5ae33973e8c53e4a0e0'; // Chainlink price feed contract
        if (!feedAddress) {
            logError('ChainlinkPriceFeedRPC', new Error(`No Chainlink feed configured for ${assetKey}`));
            return;
        }

        try {
            const feed = new ethers.Contract(feedAddress, CHAINLINK_ABI, provider);
            
            const [decimals, roundData] = await Promise.all([
                feed.decimals(),
                feed.latestRoundData()
            ]);

            const answer: bigint = roundData[1];
            const updatedAt: bigint = roundData[3];

            // Convert to 18 decimals (oracle standard)
            const priceInWei = answer * (10n ** (18n - BigInt(decimals)));

            result[assetKey] = {
                price: Number(priceInWei),
                feedTimestamp: new Date(Number(updatedAt) * 1000).toISOString()
            };

            const humanPrice = ethers.formatUnits(answer, decimals);
            logInfo('ChainlinkPriceFeedRPC', `${assetKey}: $${humanPrice} (from ${feedAddress})`);
        } catch (err) {
            logError('ChainlinkPriceFeedRPC', new Error(`Failed to fetch ${assetKey} from ${feedAddress}: ${(err as Error).message}`));
        }
    });

    await Promise.all(fetchPromises);
    return result;
}
