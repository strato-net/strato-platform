import cron from 'node-cron';
import { logInfo, logError, logFeedUpdate } from './utils/logger';
import { fetchBatchPrices, generateConstantPrices } from './adapters/genericRestAdapter';
import { pushAssetPrices } from './utils/oraclePusher';
import { ConfigLoader } from './utils/configLoader';
import { Asset } from './types';
import * as fs from 'fs';
import * as path from 'path';

// State file for storing last-known-good prices
const STATE_FILE = path.join(process.cwd(), 'oracle-state.json');
const ANCHORING_THRESHOLD = 0.15; // 15% deviation threshold
const MAX_PRICE_AGE_MS = 3600000; // 1 hour staleness threshold

interface OracleState {
    lastGoodPrices: Record<string, number>;
}

// Load last-known-good prices from state file
function loadState(): OracleState {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const data = fs.readFileSync(STATE_FILE, 'utf-8');
            return JSON.parse(data);
        }
    } catch (error) {
        logError('CronScheduler', new Error(`Failed to load state file: ${error}`));
    }
    return { lastGoodPrices: {} };
}

// Save last-known-good prices to state file
function saveState(state: OracleState): void {
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (error) {
        logError('CronScheduler', new Error(`Failed to save state file: ${error}`));
    }
}

// Calculate median of an array of numbers
function calculateMedian(values: number[]): number {
    if (values.length === 0) {
        throw new Error('Cannot calculate median of empty array');
    }

    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);

    if (sorted.length % 2 === 0) {
        // Even number of values: return average of two middle values
        return Math.floor((sorted[mid - 1] + sorted[mid]) / 2);
    } else {
        // Odd number of values: return middle value
        return sorted[mid];
    }
}

// Validate individual price entry
function isValidPrice(priceData: { price: number; feedTimestamp: string }): boolean {
    // Check if price is finite, positive, and non-zero
    if (!Number.isFinite(priceData.price) || priceData.price <= 0) {
        return false;
    }

    // Check if timestamp is valid
    if (!priceData.feedTimestamp) {
        return false;
    }

    // Check if price is fresh (not older than 1 hour)
    try {
        const feedTime = new Date(priceData.feedTimestamp).getTime();
        const now = Date.now();
        if (isNaN(feedTime) || now - feedTime > MAX_PRICE_AGE_MS) {
            return false;
        }
    } catch {
        return false;
    }

    return true;
}

// Check if candidate price passes anchoring safety check
function passesAnchoringCheck(candidatePrice: number, lastGoodPrice: number | undefined): boolean {
    // If no previous price exists, accept the candidate
    if (lastGoodPrice === undefined) {
        return true;
    }

    // Calculate deviation
    const deviation = Math.abs(candidatePrice - lastGoodPrice) / lastGoodPrice;

    return deviation <= ANCHORING_THRESHOLD;
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
    return false; // HOTFIX!!
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

// Process all feeds in parallel and combine results
async function processAllFeeds(configLoader: ConfigLoader): Promise<void> {
    const allFeeds = configLoader.getResolvedFeeds();
    const marketClosed = isMetalsMarketClosed();
    
    const resolvedFeeds = allFeeds.filter(feed => {
        if (feed.name === 'metals-batch') return !marketClosed;
        if (feed.name === 'metals-weekend') return marketClosed;
        return true;
    });
    
    logInfo('CronScheduler', `Metals market ${marketClosed ? 'closed' : 'open'}, using feeds: [${resolvedFeeds.map(f => f.name).join(', ')}]`);
    
    // Process all feeds in parallel - collect results as they complete until timeout
    const feedPromises = resolvedFeeds.map(async (feed, index) => {
        try {
            return { index, feedName: feed.name, result: await processBatchFeed(feed, configLoader), error: null };
        } catch (err) {
            const error = err as Error;
            logError('CronScheduler', new Error(`${feed.name}: ${error.message}`));
            return { index, feedName: feed.name, result: null, error: error.message };
        }
    });

    // Wait for all feeds to complete or timeout
    const completedFeeds = new Set<string>();
    const feedResults: Array<{ index: number; feedName: string; result: any; error: string | null }> = [];

    const timeoutMs = 60000;
    const startTime = Date.now();
    let timedOut = false;

    await Promise.race([
        (async () => {
            for (const promise of feedPromises) {
                try {
                    const result = await promise;
                    completedFeeds.add(result.feedName);
                    feedResults.push(result);
                } catch (err) {
                    // Individual feed errors are already handled in the promise
                }
            }
        })(),
        new Promise((resolve) => setTimeout(() => { timedOut = true; resolve(undefined); }, timeoutMs))
    ]);

    // Log timeout info if it occurred
    if (timedOut) {
        const pendingFeeds = resolvedFeeds.filter(f => !completedFeeds.has(f.name)).map(f => f.name);
        const completedList = Array.from(completedFeeds);
        logError('CronScheduler', new Error(
            `Feed processing timeout after ${Date.now() - startTime}ms. ` +
            `Feeds completed: [${completedList.join(', ') || 'none'}]. ` +
            `Feeds still pending: [${pendingFeeds.join(', ') || 'none'}]`
        ));
    }

    // Collect all successful results from completed feeds
    const allAssetPrices: Record<string, number> = {};
    const allAssetAddresses: Record<string, string> = {};
    const allAssetSources: Record<string, string[]> = {};

    feedResults.forEach(({ result, feedName }) => {
        if (result) {
            const { assetPrices, assetAddresses, assetSources } = result;

            // Merge results from all feeds
            Object.keys(assetPrices).forEach(assetName => {
                allAssetPrices[assetName] = assetPrices[assetName];
                allAssetAddresses[assetName] = assetAddresses[assetName];
                allAssetSources[assetName] = assetSources[assetName];
            });
        }
    });

    const allExpectedAssets = new Set(
        resolvedFeeds.flatMap(feed => feed.assets.map(asset => asset.name))
    );

    const missingAssets = Array.from(allExpectedAssets).filter(name => !allAssetPrices[name]);
    if (missingAssets.length > 0) {
        logError('CronScheduler', new Error(`No price data found for assets: [${missingAssets.join(', ')}]`));
    }

    if (Object.keys(allAssetPrices).length === 0) {
        throw new Error('No valid prices received from any feed');
    }

    // Load state with last-known-good prices
    const state = loadState();

    // Step 3: Apply anchoring safety check for each asset
    const assetsToSubmit: string[] = [];
    const addressesToSubmit: string[] = [];
    const pricesToSubmit: number[] = [];
    const rejectedAssets: Array<{ name: string; candidate: number; lastGood: number; deviation: number }> = [];

    Object.keys(allAssetPrices).forEach(assetName => {
        const candidatePrice = allAssetPrices[assetName];
        const assetAddress = allAssetAddresses[assetName];
        const lastGoodPrice = state.lastGoodPrices[assetAddress];

        // Check anchoring
        if (passesAnchoringCheck(candidatePrice, lastGoodPrice)) {
            // Accept and queue for submission
            assetsToSubmit.push(assetName);
            addressesToSubmit.push(assetAddress);
            pricesToSubmit.push(candidatePrice);

            // Update last-known-good price
            state.lastGoodPrices[assetAddress] = candidatePrice;
        } else {
            // Reject update due to anchoring violation
            const deviation = Math.abs(candidatePrice - lastGoodPrice!) / lastGoodPrice!;
            rejectedAssets.push({
                name: assetName,
                candidate: candidatePrice,
                lastGood: lastGoodPrice!,
                deviation
            });
            logError('CronScheduler', new Error(
                `Anchoring check failed for ${assetName}: ` +
                `candidate=${candidatePrice}, lastGood=${lastGoodPrice}, deviation=${(deviation * 100).toFixed(2)}%`
            ));
        }
    });

    // Log rejected assets summary
    if (rejectedAssets.length > 0) {
        logError('CronScheduler', new Error(
            `Rejected ${rejectedAssets.length} asset(s) due to anchoring violations (>15% deviation): ` +
            rejectedAssets.map(a => `${a.name} (${(a.deviation * 100).toFixed(2)}%)`).join(', ')
        ));
    }

    // Only submit if we have assets that passed anchoring check
    if (assetsToSubmit.length === 0) {
        throw new Error('All assets rejected by anchoring safety check');
    }

    // Submit accepted assets to the contract
    const result = await pushAssetPrices(addressesToSubmit, pricesToSubmit);

    // Save updated state
    saveState(state);

    // Log success for each submitted asset
    assetsToSubmit.forEach(assetName => {
        const price = allAssetPrices[assetName];
        const sources = allAssetSources[assetName];

        logFeedUpdate(assetName, price, sources.map(s => ({ name: s, price })), result.hash);
    });
}

async function processBatchFeed(feed: any, configLoader: ConfigLoader): Promise<{
    assetPrices: Record<string, number>;
    assetAddresses: Record<string, string>;
    assetSources: Record<string, string[]>;
}> {
    const resolvedFeed = configLoader.getResolvedFeeds().find(f => f.name === feed.name);
    if (!resolvedFeed) {
        throw new Error(`Feed ${feed.name} not found in resolved configuration`);
    }

    // Check if this feed uses constant pricing
    const hasConstantSource = resolvedFeed.sources.includes('constant');
    if (hasConstantSource) {
        const constantPrices = generateConstantPrices(resolvedFeed.assets);
        const assetPrices: Record<string, number> = {};
        const assetAddresses: Record<string, string> = {};
        const assetSources: Record<string, string[]> = {};
        
        resolvedFeed.assets.forEach(asset => {
            const priceData = constantPrices[asset.name];
            if (priceData) {
                assetPrices[asset.name] = priceData.price;
                assetAddresses[asset.name] = asset.targetAssetAddress;
                assetSources[asset.name] = ['constant'];
            }
        });
        
        return { assetPrices, assetAddresses, assetSources };
    }

    // Track which sources have completed
    const completedSources = new Set<string>();
    const startTime = Date.now();

    // Prepare parallel fetch tasks for batch sources
    const fetchTasks = resolvedFeed.sources.map(async (sourceName: string) => {
        const fetchStartTime = Date.now();
        logInfo('CronScheduler', `${feed.name}: Starting fetch from source ${sourceName}`);

        try {
            const sourceConfig = configLoader.getSourceConfig(sourceName);
            const batchResult = await fetchBatchPrices(resolvedFeed.assets, sourceConfig);

            completedSources.add(sourceName);
            const fetchDuration = Date.now() - fetchStartTime;
            logInfo('CronScheduler', `${feed.name}: Completed fetch from source ${sourceName} in ${fetchDuration}ms`);

            return { batchResult, source: sourceName, success: true };

        } catch (err) {
            const error = err as Error;
            completedSources.add(sourceName);
            const fetchDuration = Date.now() - fetchStartTime;
            logError('CronScheduler', new Error(`${feed.name}: Failed to fetch from source ${sourceName} after ${fetchDuration}ms: ${error.message}`));

            return { batchResult: {}, source: sourceName, success: false, error: error.message };
        }
    });

    // Wait for sources to complete or timeout - collect results as they come in
    const sourceResults: Array<{ batchResult: any; source: string; success: boolean; error?: string }> = [];
    const timeoutMs = 30000;
    let timedOut = false;

    await Promise.race([
        (async () => {
            for (const promise of fetchTasks) {
                try {
                    const result = await promise;
                    completedSources.add(result.source);
                    sourceResults.push(result);
                } catch (err) {
                    // Individual source errors are already handled in fetchTasks
                }
            }
        })(),
        new Promise((resolve) => setTimeout(() => { timedOut = true; resolve(undefined); }, timeoutMs))
    ]);

    // Log timeout info if it occurred
    if (timedOut) {
        const duration = Date.now() - startTime;
        const pendingSources = resolvedFeed.sources.filter((s: string) => !completedSources.has(s));
        const completedSourcesList = Array.from(completedSources);

        logError('CronScheduler', new Error(
            `${feed.name}: Timeout after ${duration}ms. ` +
            `Sources completed: [${completedSourcesList.join(', ') || 'none'}]. ` +
            `Sources still pending: [${pendingSources.join(', ') || 'none'}]`
        ));
    }

    // Process completed source results
    const allSuccessfulSources: Array<{name: string, prices: Record<string, number>}> = [];
    const failedSources: string[] = [];

    sourceResults.forEach((result) => {
        if (result.success) {
            allSuccessfulSources.push({
                name: result.source,
                prices: result.batchResult
            });
        } else {
            failedSources.push(result.source);
            // Error already logged in fetchTasks
        }
    });

    // Log summary of source results
    const successfulSourceNames = allSuccessfulSources.map(s => s.name);
    logInfo('CronScheduler', `${feed.name}: ${successfulSourceNames.length}/${resolvedFeed.sources.length} sources succeeded. Successful: [${successfulSourceNames.join(', ')}]. Failed: [${failedSources.join(', ')}]`);

    // Mark service as unhealthy if any source fails
    if (failedSources.length > 0) {
        const error = `Source failures for feed ${feed.name}: [${failedSources.join(', ')}]`;
        logError('CronScheduler', new Error(error));
    }

    // Calculate median prices for each asset across sources with input validation
    const assetPrices: Record<string, number> = {};
    const assetAddresses: Record<string, string> = {};
    const assetSources: Record<string, string[]> = {};

    resolvedFeed.assets.forEach((asset: Asset) => {
        const validPrices: number[] = [];
        const sources: string[] = [];

        // Step 1: Input validation - collect and validate prices from all sources
        allSuccessfulSources.forEach(source => {
            const assetResult = source.prices[asset.name] as any;
            if (assetResult) {
                // Validate the price entry
                if (isValidPrice(assetResult)) {
                    validPrices.push(assetResult.price);
                    sources.push(source.name);
                } else {
                    logError('CronScheduler', new Error(
                        `${feed.name}: Dropped invalid price for ${asset.name} from ${source.name} ` +
                        `(price: ${assetResult.price}, timestamp: ${assetResult.feedTimestamp})`
                    ));
                }
            }
        });

        // If no valid prices remain, skip this asset
        if (validPrices.length === 0) {
            logError('CronScheduler', new Error(
                `${feed.name}: No valid prices for ${asset.name} after validation`
            ));
            return;
        }

        // Step 2: Calculate candidate price using median
        const candidatePrice = calculateMedian(validPrices);

        assetPrices[asset.name] = candidatePrice;
        assetAddresses[asset.name] = asset.targetAssetAddress;
        assetSources[asset.name] = sources;
    });

    return { assetPrices, assetAddresses, assetSources };
}

export async function startCronScheduler(): Promise<void> {
    const configLoader = new ConfigLoader();
    const resolvedFeeds = configLoader.getResolvedFeeds();
    
    logInfo('CronScheduler', `Starting Oracle Service with ${resolvedFeeds.length} feeds`);

    // Single cron job that processes all feeds in parallel
    const jobFunction = async () => {
        try {
            await processAllFeeds(configLoader);
        } catch (err) {
            const error = err as Error;
            logError('CronScheduler', new Error(`Feed processing error: ${error.message}`));
        }
    };

    // Schedule the job based on cron schedule provided.
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
