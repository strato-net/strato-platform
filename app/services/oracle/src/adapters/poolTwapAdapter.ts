import { apiRequest } from '../utils/apiClient';
import { SourceConfig, BatchPriceResult, PoolConfig } from '../types';
import { logError } from '../utils/logger';

const OBSERVE_SELECTOR = '883bdbfd'; // observe(uint32[])

const word = (n: number | bigint) => BigInt(n).toString(16).padStart(64, '0');

// observe([twapSeconds, 0]) -> time-weighted average tick over the window
async function fetchAverageTick(rpcUrl: string, pool: string, twapSeconds: number): Promise<number> {
    const data = `0x${OBSERVE_SELECTOR}${word(32)}${word(2)}${word(twapSeconds)}${word(0)}`;
    const response = await apiRequest(
        { method: 'POST', url: rpcUrl, headers: { 'Content-Type': 'application/json' }, data: { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: pool, data }, 'latest'] } },
        { logPrefix: 'PoolTwapAdapter', apiUrl: rpcUrl, method: 'POST' }
    );
    const result: string | undefined = response.data?.result;
    if (!result || result.length < 2 + 64 * 6) throw new Error(`${pool}: invalid observe() response ${response.data?.error?.message || ''}`);

    // (int56[] tickCumulatives, uint160[] secondsPerLiquidityCumulativeX128s): head = 2 offsets, then length + elements
    const hex = result.slice(2);
    const base = Number(BigInt('0x' + hex.slice(0, 64))) * 2;
    const cumulative = (i: number) => BigInt.asIntN(256, BigInt('0x' + hex.slice(base + 64 * (i + 1), base + 64 * (i + 2))));
    const delta = cumulative(1) - cumulative(0);
    let tick = delta / BigInt(twapSeconds);
    if (delta < 0n && delta % BigInt(twapSeconds) !== 0n) tick -= 1n; // round toward negative infinity like Uniswap
    return Number(tick);
}

function tickToUsdPrice(tick: number, pool: PoolConfig): number {
    const token1PerToken0 = Math.pow(1.0001, tick) * Math.pow(10, pool.decimals0 - pool.decimals1);
    return pool.baseIsToken0 ? token1PerToken0 : 1 / token1PerToken0;
}

export async function fetchPoolTwaps(sourceConfig: SourceConfig): Promise<BatchPriceResult> {
    const result: BatchPriceResult = {};
    const twapSeconds = sourceConfig.twapSeconds || 60;
    await Promise.all(Object.entries(sourceConfig.pools || {}).map(async ([symbol, pool]) => {
        try {
            const price = Math.floor(tickToUsdPrice(await fetchAverageTick(sourceConfig.url!, pool.address, twapSeconds), pool) * 1e18);
            if (price > 0 && isFinite(price)) result[symbol] = { price, feedTimestamp: new Date().toISOString() };
        } catch (err) {
            logError('PoolTwapAdapter', new Error(`${symbol}: ${(err as Error).message}`));
        }
    }));
    return result;
}
