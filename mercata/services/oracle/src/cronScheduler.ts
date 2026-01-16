import cron from 'node-cron';
import { logInfo, logError, logFeedUpdate } from './utils/logger';
import { fetchPrices, generateConstantPrices } from './adapters/genericRestAdapter';
import { pushAssetPrices } from './utils/oraclePusher';
import { ConfigLoader } from './utils/configLoader';
import { SourceResult, AggregatedPrice } from './types';
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

async function fetchFromAllSources(configLoader: ConfigLoader): Promise<Map<string, SourceResult>> {
    const allSources = Object.entries(configLoader.getAllSourceConfigs());
    const results = new Map<string, SourceResult>();
    
    // Wrap each fetch with its own timeout to capture partial results
    const fetchPromises = allSources.map(async ([sourceName, sourceConfig]): Promise<SourceResult> => {
        const startTime = Date.now();
        
        try {
            const fetchPromise = (async () => {
                if (sourceName === 'constant') {
                    return generateConstantPrices(sourceConfig.assets, configLoader.getAllAssets());
                }
                return await fetchPrices(sourceConfig);
            })();
            
            const prices = await Promise.race([
                fetchPromise,
                new Promise<never>((_, reject) => 
                    setTimeout(() => reject(new Error('Timeout')), TIMEOUTS.FETCH)
                )
            ]);
            
            return { sourceName, prices, success: true, duration: Date.now() - startTime };
        } catch (err) {
            const duration = Date.now() - startTime;
            logError('CronScheduler', new Error(`${sourceName} failed (${duration}ms): ${(err as Error).message}`));
            return { sourceName, prices: {}, success: false, duration };
        }
    });
    
    // Wait for all fetches (each has its own timeout)
    const fetchResults = await Promise.all(fetchPromises);
    
    // Store results and log summary
    const succeeded: string[] = [];
    const failed: string[] = [];
    
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
    const allAssets = configLoader.getAllAssets();
    const aggregated: AggregatedPrice[] = [];
    
    Object.keys(allAssets).forEach(assetKey => {
        const asset = allAssets[assetKey];
        const useProxy = asset.weekendProxy && marketClosed;
        const fetchSymbol = useProxy ? asset.weekendProxy! : assetKey;
        const expectedSources = useProxy 
            ? configLoader.getSourcesForProxySymbol(fetchSymbol)
            : configLoader.getSourcesForAsset(assetKey);
        const requiredSources = asset.constantPrice !== undefined ? 1 : ORACLE_CONFIG.MIN_VALID_SOURCES;
        
        if (useProxy) {
            logInfo('CronScheduler', `${assetKey}: Using proxy ${fetchSymbol}`);
        }
        
        // Collect prices from sources
        const prices: number[] = [];
        const sources: Array<{ name: string; price: number }> = [];
        
        expectedSources.forEach(sourceName => {
            const result = sourceResults.get(sourceName);
            const data = result?.success && result.prices[fetchSymbol];
            if (data) {
                prices.push(data.price);
                sources.push({ name: sourceName, price: data.price });
            }
        });
        
        // Log missing sources
        const missing = expectedSources.filter(s => !sources.some(src => src.name === s));
        if (missing.length > 0) {
            logError('CronScheduler', new Error(`Missing sources for ${assetKey}: [${missing.join(', ')}]`));
        }
        
        // Validate and calculate median
        if (prices.length >= requiredSources) {
            aggregated.push({
                assetKey,
                medianPrice: calculateMedian(prices),
                targetAddress: asset.targetAssetAddress,
                sources,
                expectedSourceCount: expectedSources.length
            });
        } else {
            logError('CronScheduler', new Error(
                `Insufficient sources for ${assetKey}: got ${prices.length}, need ${requiredSources}`
            ));
            // Still add to array but mark as failed
            aggregated.push({
                assetKey,
                medianPrice: 0,
                targetAddress: asset.targetAssetAddress,
                sources,
                expectedSourceCount: expectedSources.length,
                failed: true,
                error: `Not enough sources (${prices.length}/${requiredSources})`
            });
        }
    });
    
    return aggregated;
}

// ============================================================================
// Main Orchestrator
// ============================================================================

async function processAllAssets(configLoader: ConfigLoader): Promise<void> {
    const marketClosed = isMetalsMarketClosed();
    const assetCount = Object.keys(configLoader.getAllAssets()).length;
    
    logInfo('CronScheduler', `Market ${marketClosed ? 'closed' : 'open'}, processing ${assetCount} assets`);
    
    const sourceResults = await fetchFromAllSources(configLoader);
    const aggregatedPrices = aggregatePrices(configLoader, sourceResults, marketClosed);
    
    // Filter out failed assets for submission
    const validPrices = aggregatedPrices.filter(p => !p.failed);
    const failedPrices = aggregatedPrices.filter(p => p.failed);
    
    if (validPrices.length === 0) {
        throw new Error('No valid prices to submit');
    }
    
    const submittingAssets = validPrices.map(p => p.assetKey).join(', ');
    const skippedAssets = failedPrices.map(p => p.assetKey).join(', ');
    
    if (failedPrices.length > 0) {
        logInfo('CronScheduler', `Submitting ${validPrices.length} prices: [${submittingAssets}]. Skipped ${failedPrices.length}: [${skippedAssets}]`);
    } else {
        logInfo('CronScheduler', `Submitting ${validPrices.length} prices: [${submittingAssets}]`);
    }
    
    const result = await pushAssetPrices(
        validPrices.map(p => p.targetAddress),
        validPrices.map(p => p.medianPrice)
    );
    
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
