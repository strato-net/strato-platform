import cron from 'node-cron';
import { logInfo, logError, logFeedUpdate } from './utils/logger';
import { fetchPrices, generateConstantPrices } from './adapters/genericRestAdapter';
import { pushAssetPrices } from './utils/oraclePusher';
import { checkBalances } from './utils/balanceChecker';
import { withTimeout } from './utils/apiClient';
import { ConfigLoader } from './utils/configLoader';
import { SourceResult, AggregatedPrice, SourceConfig } from './types';
import { TIMEOUTS, ORACLE_CONFIG } from './utils/constants';

// ============================================================================
// Helpers
// ============================================================================

function calculateMedian(prices: number[]): number {
    if (prices.length === 0) return 0;
    const sorted = [...prices].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0
        ? sorted[mid]
        : Math.floor((sorted[mid - 1] + sorted[mid]) / 2);
}

function isMetalsMarketClosed(): boolean {
    const now = new Date();
    const etString = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
    const etDate = new Date(etString);
    const day = etDate.getDay();
    const hour = etDate.getHours();
    const minute = etDate.getMinutes();
    
    if (day === 5 && hour >= 12) return true;  // Friday after noon ET
    if (day === 6) return true;                 // Saturday
    if (day === 0) return true;                 // Sunday
    if (day === 1 && (hour < 5 || (hour === 5 && minute < 30))) return true; // Monday before 5:30 AM ET
    
    return false;
}

export function getCronSchedule(): string {
    const schedule = process.env.CRON_SCHEDULE || "0 */15 * * * *";
    if (!cron.validate(schedule)) {
        throw new Error(
            `Invalid CRON_SCHEDULE: ${schedule}. See https://nodecron.com/cron-syntax.html for cron schedule syntax.`
        );
    }
    return schedule;
}

// ============================================================================
// Step 1: Fetch from All Sources
// ============================================================================

async function fetchSource(sourceName: string, sourceConfig: SourceConfig, configLoader: ConfigLoader): Promise<SourceResult> {
    const startTime = Date.now();
    try {
        const fetchPromise = sourceName === 'constant'
            ? Promise.resolve(generateConstantPrices(sourceConfig.assets, configLoader.getAllAssets()))
            : fetchPrices(sourceConfig);
        const prices = await withTimeout(fetchPromise, TIMEOUTS.FETCH);
        return { sourceName, prices, success: true, duration: Date.now() - startTime };
    } catch (err) {
        const duration = Date.now() - startTime;
        logError('CronScheduler', new Error(`${sourceName} failed (${duration}ms): ${(err as Error).message}`));
        return { sourceName, prices: {}, success: false, duration };
    }
}

async function fetchFromAllSources(configLoader: ConfigLoader): Promise<Map<string, SourceResult>> {
    const allSources = Object.entries(configLoader.getAllSourceConfigs());
    const fetchResults = await Promise.all(
        allSources.map(([name, config]) => fetchSource(name, config, configLoader))
    );
    
    const results = new Map<string, SourceResult>();
    const succeeded: string[] = [], failed: string[] = [];
    fetchResults.forEach(r => {
        results.set(r.sourceName, r);
        (r.success ? succeeded : failed).push(`${r.sourceName} (${r.duration}ms)`);
    });
    
    logInfo('CronScheduler', `${succeeded.length}/${allSources.length} sources: [${succeeded.join(', ')}]${failed.length ? `. Failed: [${failed.join(', ')}]` : ''}`);
    return results;
}

// ============================================================================
// Step 2: Aggregate Prices
// ============================================================================

function aggregatePrices(
    configLoader: ConfigLoader,
    sourceResults: Map<string, SourceResult>,
    marketClosed: boolean
): AggregatedPrice[] {
    return Object.entries(configLoader.getAllAssets()).map(([assetKey, asset]) => {
        const useProxy = asset.weekendProxy && marketClosed;
        const requiredSources = asset.constantPrice !== undefined ? 1 : ORACLE_CONFIG.MIN_VALID_SOURCES;
        const weekdaySources = configLoader.getSourcesForAsset(assetKey);
        const sources: Array<{ name: string; price: number }> = [];
        let expectedCount = weekdaySources.length;

        const collect = (names: string[], symbol: string) => {
            names.forEach(name => {
                const data = sourceResults.get(name)?.success && sourceResults.get(name)?.prices[symbol];
                if (data) sources.push({ name, price: data.price });
            });
            return sources.length;
        };

        if (!useProxy) {
            collect(weekdaySources, assetKey);
        } else {
            const proxySources = configLoader.getSourcesForProxySymbol(asset.weekendProxy!);
            logInfo('CronScheduler', `${assetKey}: Using proxy ${asset.weekendProxy}`);
            if (collect(proxySources, asset.weekendProxy!) >= requiredSources) {
                expectedCount = proxySources.length;
            } else {
                logInfo('CronScheduler', `${assetKey}: Proxy insufficient, falling back`);
                sources.length = 0;
                collect(weekdaySources, assetKey);
                expectedCount = weekdaySources.length;
            }
        }
        
        const isValid = sources.length >= requiredSources;
        if (!isValid) logError('CronScheduler', new Error(`Insufficient sources for ${assetKey}: got ${sources.length}, need ${requiredSources}`));
        
        return {
            assetKey,
            medianPrice: isValid ? calculateMedian(sources.map(s => s.price)) : 0,
            targetAddress: asset.targetAssetAddress,
            sources,
            expectedSourceCount: expectedCount,
            ...(isValid ? {} : { failed: true, error: `Not enough sources (${sources.length}/${requiredSources})` })
        };
    });
}

// ============================================================================
// Main Orchestrator
// ============================================================================

async function processAllAssets(configLoader: ConfigLoader): Promise<void> {
    await checkBalances();
    const marketClosed = isMetalsMarketClosed();
    const assetCount = Object.keys(configLoader.getAllAssets()).length;
    
    logInfo('CronScheduler', `Market ${marketClosed ? 'closed' : 'open'}, processing ${assetCount} assets`);
    
    const sourceResults = await fetchFromAllSources(configLoader);
    const aggregatedPrices = aggregatePrices(configLoader, sourceResults, marketClosed);
    
    // Partition into valid and failed prices in single pass
    const validPrices: AggregatedPrice[] = [];
    const failedPrices: AggregatedPrice[] = [];
    aggregatedPrices.forEach(p => (p.failed ? failedPrices : validPrices).push(p));
    
    if (validPrices.length === 0) {
        throw new Error('No valid prices to submit');
    }
    
    const skipped = failedPrices.length ? `. Skipped ${failedPrices.length}: [${failedPrices.map(p => p.assetKey).join(', ')}]` : '';
    logInfo('CronScheduler', `Submitting ${validPrices.length} prices: [${validPrices.map(p => p.assetKey).join(', ')}]${skipped}`);
    
    const result = await pushAssetPrices(validPrices);
    
    // Log all prices (including failed ones)
    aggregatedPrices.forEach(p => logFeedUpdate(p.assetKey, p.medianPrice, p.sources, p.expectedSourceCount, result.hash, p.failed, p.error));
}

// ============================================================================
// Scheduler
// ============================================================================

export async function startCronScheduler(): Promise<void> {
    const configLoader = new ConfigLoader();
    const allAssets = Object.keys(configLoader.getAllAssets());
    
    logInfo('CronScheduler', `Starting Oracle with ${allAssets.length} assets: [${allAssets.join(', ')}]`);

    const cronSchedule = getCronSchedule();
    logInfo('CronScheduler', `Cron: ${cronSchedule}`);
    
    const job = async () => {
        try {
            await processAllAssets(configLoader);
        } catch (err) {
            logError('CronScheduler', new Error(`Processing error: ${(err as Error).message}`));
        }
    };

    cron.schedule(cronSchedule, job);
    setTimeout(job, 1000); // Run immediately
}

// Graceful shutdown
process.on('SIGINT', () => { logInfo('CronScheduler', 'SIGINT received'); process.exit(0); });
process.on('SIGTERM', () => { logInfo('CronScheduler', 'SIGTERM received'); process.exit(0); });
