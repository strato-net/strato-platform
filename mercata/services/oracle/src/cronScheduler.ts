import cron from 'node-cron';
import { logInfo, logError, logFeedUpdate } from './utils/logger';
import { fetchBatchPrices, generateConstantPrices } from './adapters/genericRestAdapter';
import { pushAssetPrices } from './utils/oraclePusher';
import { ConfigLoader } from './utils/configLoader';
import { ResolvedAsset } from './types';

// Minimum number of valid sources required to submit a price
const MIN_VALID_SOURCES = 3;

// Calculate median price from an array of prices
function calculateMedian(prices: number[]): number {
    if (prices.length === 0) return 0;
    const sorted = [...prices].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0
        ? sorted[mid]
        : Math.floor((sorted[mid - 1] + sorted[mid]) / 2);
}

export async function getCronSchedule(): Promise<string> {
    const schedule = process.env.CRON_SCHEDULE || "0 */15 * * * *";
    if (!cron.validate(schedule)) {
        throw new Error(
            `Invalid CRON_SCHEDULE: ${schedule}. See https://nodecron.com/cron-syntax.html for cron schedule syntax.`
        );
    }
    
    return schedule;
}

function isMetalsMarketClosed(): boolean {
    const now = new Date();
    const etString = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
    const etDate = new Date(etString);
    const day = etDate.getDay();
    const hour = etDate.getHours();
    const minute = etDate.getMinutes();
    
    // Friday after 12:00 PM (noon) ET - LBMA stops
    if (day === 5 && hour >= 12) return true;
    // Saturday all day
    if (day === 6) return true;
    // Sunday all day
    if (day === 0) return true;
    // Monday before 5:30 AM ET - first LBMA auction
    if (day === 1 && (hour < 5 || (hour === 5 && minute < 30))) return true;
    
    return false;
}

// Process all assets and submit prices
async function processAllAssets(configLoader: ConfigLoader): Promise<void> {
    const marketClosed = isMetalsMarketClosed();
    const assetsBySchedule = configLoader.getAssetsBySchedule();
    
    // All assets to process
    const assetsToProcess: string[] = [
        ...assetsBySchedule.always,
        ...assetsBySchedule.metals,
        ...assetsBySchedule.constant
    ];
    
    logInfo('CronScheduler', `Metals market ${marketClosed ? 'closed' : 'open'}, processing ${assetsToProcess.length} assets`);
    
    // Collect prices for all assets
    const allAssetPrices: Record<string, number> = {};
    const allAssetAddresses: Record<string, string> = {};
    const allAssetSources: Record<string, Array<{ name: string; price: number }>> = {};
    
    // Build source-to-assets mapping
    // For metals when market is closed, we'll use proxy sources instead
    const sourceToAssets = new Map<string, ResolvedAsset[]>();
    const assetToExpectedSources = new Map<string, string[]>();
    
    assetsToProcess.forEach(assetKey => {
        const asset = configLoader.getAsset(assetKey);
        const isMetalAsset = asset.weekendProxy !== undefined;
        const useProxy = isMetalAsset && marketClosed;
        
        let expectedSources: string[];
        let resolvedAsset: ResolvedAsset;
        
        if (useProxy) {
            // Market closed - use proxy symbol and sources
            const proxySymbol = asset.weekendProxy!;
            expectedSources = configLoader.getSourcesForProxySymbol(proxySymbol);
            
            // Create resolved asset - the key stays the same (XAU, XAG) 
            // but we'll use the proxy symbol for lookups
            resolvedAsset = {
                key: assetKey,
                targetAssetAddress: asset.targetAssetAddress,
                weekendProxy: proxySymbol
            };
            
            logInfo('CronScheduler', `${assetKey}: Using weekend proxy ${proxySymbol} from sources [${expectedSources.join(', ')}]`);
        } else {
            // Normal fetch - use asset's own sources
            expectedSources = configLoader.getSourcesForAsset(assetKey);
            resolvedAsset = {
                key: assetKey,
                ...asset
            };
        }
        
        assetToExpectedSources.set(assetKey, expectedSources);
        
        expectedSources.forEach(sourceName => {
            if (!sourceToAssets.has(sourceName)) {
                sourceToAssets.set(sourceName, []);
            }
            sourceToAssets.get(sourceName)!.push(resolvedAsset);
        });
    });
    
    // Fetch prices from all sources in parallel
    const sourcePromises = Array.from(sourceToAssets.entries()).map(async ([sourceName, resolvedAssets]) => {
        const startTime = Date.now();
        
        try {
            const sourceConfig = configLoader.getSourceConfig(sourceName);
            
            // Handle constant source specially
            if (sourceName === 'constant') {
                const constantPrices = generateConstantPrices(resolvedAssets);
                const duration = Date.now() - startTime;
                return { sourceName, prices: constantPrices, success: true, duration };
            }
            
            // For assets using weekend proxy, we need to fetch using proxy symbol
            // but store results under the original asset key
            const assetsForFetch = resolvedAssets.map(asset => {
                if (asset.weekendProxy && marketClosed) {
                    // Create a temporary asset with the proxy symbol as the key for fetching
                    return {
                        ...asset,
                        originalKey: asset.key,
                        key: asset.weekendProxy // Use proxy symbol for API lookup
                    };
                }
                return { ...asset, originalKey: asset.key };
            });
            
            const batchResult = await fetchBatchPrices(assetsForFetch as ResolvedAsset[], sourceConfig);
            
            // Remap results back to original asset keys
            const remappedResult: Record<string, any> = {};
            assetsForFetch.forEach(asset => {
                const fetchKey = asset.key;
                const originalKey = (asset as any).originalKey;
                if (batchResult[fetchKey]) {
                    remappedResult[originalKey] = batchResult[fetchKey];
                }
            });
            
            const duration = Date.now() - startTime;
            return { sourceName, prices: remappedResult, success: true, duration };
        } catch (err) {
            const error = err as Error;
            const duration = Date.now() - startTime;
            logError('CronScheduler', new Error(`Failed to fetch from source ${sourceName} after ${duration}ms: ${error.message}`));
            return { sourceName, prices: {}, success: false, error: error.message, duration };
        }
    });
    
    // Wait for all sources to complete with timeout
    const timeoutMs = 30000;
    const startTime = Date.now();
    let timedOut = false;
    
    const sourceResults: Array<{ sourceName: string; prices: any; success: boolean; error?: string; duration: number }> = [];
    
    await Promise.race([
        (async () => {
            const results = await Promise.all(sourcePromises);
            sourceResults.push(...results);
        })(),
        new Promise((resolve) => setTimeout(() => { timedOut = true; resolve(undefined); }, timeoutMs))
    ]);
    
    if (timedOut) {
        logError('CronScheduler', new Error(`Source fetching timeout after ${Date.now() - startTime}ms`));
    }
    
    // Build source results map
    const sourceResultsMap = new Map<string, any>();
    const failedSources: string[] = [];
    const successfulSourcesWithTime: string[] = [];
    
    sourceResults.forEach(result => {
        if (result.success) {
            sourceResultsMap.set(result.sourceName, result.prices);
            successfulSourcesWithTime.push(`${result.sourceName} (${result.duration}ms)`);
        } else {
            failedSources.push(`${result.sourceName} (${result.duration}ms)`);
        }
    });
    
    logInfo('CronScheduler', `${successfulSourcesWithTime.length}/${sourceToAssets.size} sources succeeded: [${successfulSourcesWithTime.join(', ')}]${failedSources.length > 0 ? `. Failed: [${failedSources.join(', ')}]` : ''}`);
    
    // Calculate median prices for each asset
    assetsToProcess.forEach(assetKey => {
        const asset = configLoader.getAsset(assetKey);
        const expectedSources = assetToExpectedSources.get(assetKey) || [];
        
        const prices: number[] = [];
        const sources: Array<{ name: string; price: number }> = [];
        
        expectedSources.forEach(sourceName => {
            const sourceData = sourceResultsMap.get(sourceName);
            if (sourceData && sourceData[assetKey]) {
                const assetResult = sourceData[assetKey];
                if (assetResult.price && isFinite(assetResult.price) && assetResult.price > 0 && assetResult.feedTimestamp) {
                    prices.push(assetResult.price);
                    sources.push({ name: sourceName, price: assetResult.price });
                }
            }
        });
        
        // Log missing expected sources for this asset
        const receivedSources = sources.map(s => s.name);
        const missingSources = expectedSources.filter(s => !receivedSources.includes(s));
        if (missingSources.length > 0) {
            logError('CronScheduler', new Error(
                `Missing expected sources for ${assetKey}: [${missingSources.join(', ')}]`
            ));
        }
        
        // Constant-priced assets only need 1 source, others need MIN_VALID_SOURCES
        const requiredSources = asset.constantPrice !== undefined ? 1 : MIN_VALID_SOURCES;
        
        if (prices.length >= requiredSources) {
            const medianPrice = calculateMedian(prices);
            allAssetPrices[assetKey] = medianPrice;
            allAssetAddresses[assetKey] = asset.targetAssetAddress;
            allAssetSources[assetKey] = sources;
        } else {
            logError('CronScheduler', new Error(
                `Insufficient valid sources for ${assetKey}. ` +
                `Got ${prices.length}/${expectedSources.length} expected, need ${requiredSources}. ` +
                `Sources: [${sources.map(s => s.name).join(', ')}]`
            ));
        }
    });
    
    // Check for missing assets
    const missingAssets = assetsToProcess.filter(key => !allAssetPrices[key]);
    if (missingAssets.length > 0) {
        logError('CronScheduler', new Error(`No price data found for assets: [${missingAssets.join(', ')}]`));
    }
    
    if (Object.keys(allAssetPrices).length === 0) {
        throw new Error('No valid prices received from any source');
    }
    
    // Filter out proxy-only assets before submission (they're fetched but not submitted separately)
    const assetKeysToSubmit = Object.keys(allAssetPrices).filter(key => !configLoader.isProxyOnlyAsset(key));
    const proxyOnlyAssets = Object.keys(allAssetPrices).filter(key => configLoader.isProxyOnlyAsset(key));
    
    if (proxyOnlyAssets.length > 0) {
        logInfo('CronScheduler', `Excluding proxy-only assets from submission: [${proxyOnlyAssets.join(', ')}]`);
    }
    
    // Submit assets to the contract
    const assetAddresses = assetKeysToSubmit.map(key => allAssetAddresses[key]);
    const assetPriceValues = assetKeysToSubmit.map(key => allAssetPrices[key]);
    
    logInfo('CronScheduler', `Submitting prices for ${assetKeysToSubmit.length} assets`);
    const result = await pushAssetPrices(assetAddresses, assetPriceValues);
    
    // Log success for each asset
    assetKeysToSubmit.forEach(assetKey => {
        const price = allAssetPrices[assetKey];
        const sources = allAssetSources[assetKey];
        logFeedUpdate(assetKey, price, sources, result.hash);
    });
}

export async function startCronScheduler(): Promise<void> {
    const configLoader = new ConfigLoader();
    const assetsBySchedule = configLoader.getAssetsBySchedule();
    const totalAssets = 
        assetsBySchedule.always.length + 
        assetsBySchedule.metals.length + 
        assetsBySchedule.constant.length;
    
    logInfo('CronScheduler', `Starting Oracle Service with ${totalAssets} configured assets`);
    logInfo('CronScheduler', `  - Crypto: ${assetsBySchedule.always.length} (${assetsBySchedule.always.join(', ')})`);
    logInfo('CronScheduler', `  - Metals: ${assetsBySchedule.metals.length} (${assetsBySchedule.metals.join(', ')})`);
    logInfo('CronScheduler', `  - Constant: ${assetsBySchedule.constant.length} (${assetsBySchedule.constant.join(', ')})`);

    // Single cron job that processes all assets
    const jobFunction = async () => {
        try {
            await processAllAssets(configLoader);
        } catch (err) {
            const error = err as Error;
            logError('CronScheduler', new Error(`Asset processing error: ${error.message}`));
        }
    };

    // Schedule the job based on cron schedule provided
    const cronSchedule = await getCronSchedule();
    logInfo('CronScheduler', `Scheduling oracle updates (cron: ${cronSchedule})`);
    
    cron.schedule(cronSchedule, jobFunction);
    
    // Run the job immediately on startup
    setTimeout(() => {
        jobFunction();
    }, 1000); // Small delay to ensure everything is initialized
}

// Graceful shutdown
process.on('SIGINT', () => {
    logInfo('CronScheduler', 'Received SIGINT, shutting down gracefully...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    logInfo('CronScheduler', 'Received SIGTERM, shutting down gracefully...');
    process.exit(0);
});
