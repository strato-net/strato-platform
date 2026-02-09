import cron from 'node-cron';
import { logInfo, logError, logWarning, logFeedUpdate } from './utils/logger';
import { fetchPrices, generateConstantPrices } from './adapters/genericRestAdapter';
import { pushAssetPrices } from './utils/oraclePusher';
import { checkBalances } from './utils/balanceChecker';
import { fetchPreviousPrices } from './utils/priceReader';
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

function checkPriceChange(assetKey: string, newPrice: number, previousPrice: number): void {
    // Skip if previous price is 0 or missing (new asset)
    if (previousPrice <= 0 || newPrice <= 0) return;
    
    const changePercent = Math.abs((newPrice - previousPrice) / previousPrice) * 100;
    
    if (changePercent > ORACLE_CONFIG.MAX_PRICE_CHANGE_PERCENT) {
        const oldPriceUSD = (previousPrice / 1e18).toFixed(2);
        const newPriceUSD = (newPrice / 1e18).toFixed(2);
        const direction = newPrice > previousPrice ? 'increased' : 'decreased';
        logWarning('CronScheduler',
            `Significant price change alert for ${assetKey}: ${direction} ${changePercent.toFixed(2)}% (max ${ORACLE_CONFIG.MAX_PRICE_CHANGE_PERCENT}%). Previous: $${oldPriceUSD}, New: $${newPriceUSD}`
        );
    }
}

function checkSourceDivergence(assetKey: string, sources: Array<{ name: string; price: number }>, medianPrice: number): void {
    if (sources.length < 2 || medianPrice === 0) return;
    
    const prices = sources.map(s => s.price);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const spreadPercent = ((maxPrice - minPrice) / medianPrice) * 100;
    
    if (spreadPercent > ORACLE_CONFIG.MAX_SOURCE_DIVERGENCE_PERCENT) {
        const sourcePrices = sources.map(s => `${s.name}: $${(s.price / 1e18).toFixed(2)}`).join(', ');
        logWarning('CronScheduler',
            `Source divergence alert for ${assetKey}: ${spreadPercent.toFixed(2)}% spread (max ${ORACLE_CONFIG.MAX_SOURCE_DIVERGENCE_PERCENT}%). Sources: [${sourcePrices}]`
        );
    }
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
        logWarning('CronScheduler', `${sourceName} failed (${duration}ms): ${(err as Error).message}`);
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
    marketClosed: boolean,
    previousPrices: Map<string, number>
): AggregatedPrice[] {
    return Object.entries(configLoader.getAllAssets()).map(([assetKey, asset]) => {
        const useProxy = asset.weekendProxy && marketClosed;
        const requiredSources = asset.constantPrice !== undefined ? 1 : ORACLE_CONFIG.MIN_VALID_SOURCES;
        const weekdaySources = configLoader.getSourcesForAsset(assetKey);
        const sources: Array<{ name: string; price: number }> = [];
        let expectedCount = weekdaySources.length;

        const failedSources: string[] = [];

        const collect = (names: string[], symbol: string) => {
            failedSources.length = 0;
            names.forEach(name => {
                const result = sourceResults.get(name);
                const data = result?.success && result?.prices[symbol];
                if (data) {
                    sources.push({ name, price: data.price });
                } else if (result?.success) {
                    failedSources.push(`${name}(no ${symbol})`);
                } else {
                    failedSources.push(`${name}(fetch failed)`);
                }
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
        if (!isValid) {
            logError('CronScheduler', new Error(`Insufficient sources for ${assetKey}: got ${sources.length}, need ${requiredSources}. Failed: [${failedSources.join(', ')}]`));
        }
        
        const medianPrice = isValid ? calculateMedian(sources.map(s => s.price)) : 0;
        
        // Check for source divergence (alert only, still submit)
        if (isValid) {
            checkSourceDivergence(assetKey, sources, medianPrice);
            // Check for significant price change vs previous on-chain price
            const previousPrice = previousPrices.get(asset.targetAssetAddress.toLowerCase()) || 0;
            checkPriceChange(assetKey, medianPrice, previousPrice);
        }
        
        return {
            assetKey,
            medianPrice,
            targetAddress: asset.targetAssetAddress,
            sources,
            expectedSourceCount: expectedCount,
            ...(isValid ? {} : { failed: true, error: `Not enough sources (${sources.length}/${requiredSources})` })
        };
    });
}

/**
 * Adds equivalent asset prices as additional sources.
 * For example, XAU (gold) can use XAUT (Tether Gold) as an equivalent since both track gold price.
 * This allows assets with few direct sources to benefit from equivalent assets that have more sources.
 * The equivalent asset's aggregated median price is added as a single additional source.
 */
function addEquivalentAssetPrices(prices: AggregatedPrice[], configLoader: ConfigLoader): AggregatedPrice[] {
    const allAssets = configLoader.getAllAssets();
    prices.forEach(p => {
        const asset = allAssets[p.assetKey];
        if (!asset.equivalentAssets) return;

        // Add each equivalent asset's median price as an additional source
        const sourceCountBefore = p.sources.length;
        asset.equivalentAssets.forEach(equivKey => {
            const equiv = prices.find(ap => ap.assetKey === equivKey);
            if (equiv && !equiv.failed && equiv.medianPrice > 0) {
                p.sources.push({ name: `${equivKey}(equiv)`, price: equiv.medianPrice });
                p.expectedSourceCount += 1;
            }
        });

        // Recalculate median if we added any equivalent sources
        if (p.sources.length > sourceCountBefore) {
            p.medianPrice = calculateMedian(p.sources.map(s => s.price));
            if (p.failed && p.sources.length >= ORACLE_CONFIG.MIN_VALID_SOURCES) {
                delete p.failed;
                delete p.error;
            }
        }
    });
    return prices;
}

// ============================================================================
// Main Orchestrator
// ============================================================================

async function processAllAssets(configLoader: ConfigLoader): Promise<void> {
    const [, previousPrices] = await Promise.all([
        checkBalances(),
        fetchPreviousPrices()
    ]);
    
    const marketClosed = isMetalsMarketClosed();
    const assetCount = Object.keys(configLoader.getAllAssets()).length;
    
    logInfo('CronScheduler', `Market ${marketClosed ? 'closed' : 'open'}, processing ${assetCount} assets`);
    
    const sourceResults = await fetchFromAllSources(configLoader);
    const aggregatedPrices = addEquivalentAssetPrices(
        aggregatePrices(configLoader, sourceResults, marketClosed, previousPrices),
        configLoader
    );
    
    // Partition into valid and failed prices, excluding proxy-only assets (submit: false)
    const allAssets = configLoader.getAllAssets();
    const validPrices: AggregatedPrice[] = [];
    const failedPrices: AggregatedPrice[] = [];
    aggregatedPrices.forEach(p => {
        if (allAssets[p.assetKey].submit === false) return;
        (p.failed ? failedPrices : validPrices).push(p);
    });
    
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
