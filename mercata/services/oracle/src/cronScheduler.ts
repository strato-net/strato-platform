import cron from 'node-cron';
import { logInfo, logError, logFeedUpdate } from './utils/logger';
import { fetchBatchPrices, generateConstantPrices } from './adapters/genericRestAdapter';
import { pushAssetPrices } from './utils/oraclePusher';
import { ConfigLoader } from './utils/configLoader';
import { Asset } from './types';
import { validateAndFilterPrices, PriceData, PriceValidationConfig } from './utils/priceValidator';

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

    // Submit all assets to the contract - it handles round logic automatically
    const assetNames = Object.keys(allAssetPrices);
    const assetAddresses = assetNames.map(name => allAssetAddresses[name]);
    const assetPriceValues = assetNames.map(name => allAssetPrices[name]);

    const result = await pushAssetPrices(assetAddresses, assetPriceValues);

    // Log success for each asset
    assetNames.forEach(assetName => {
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

    // Calculate average prices for each asset across sources with validation
    const assetPrices: Record<string, number> = {};
    const assetAddresses: Record<string, string> = {};
    const assetSources: Record<string, string[]> = {};

    resolvedFeed.assets.forEach((asset: Asset) => {
        const pricesData: PriceData[] = [];

        allSuccessfulSources.forEach(source => {
            const assetResult = source.prices[asset.name] as any;
            if (assetResult && assetResult.price && assetResult.feedTimestamp) {
                pricesData.push({
                    price: assetResult.price,
                    feedTimestamp: assetResult.feedTimestamp,
                    sourceName: source.name
                });
            }
        });

        if (pricesData.length > 0) {
            // Apply comprehensive validation
            const validationConfig: PriceValidationConfig = {
                minPrice: resolvedFeed.minPrice,
                maxPrice: resolvedFeed.maxPrice,
                maxStalenessMs: 5 * 60 * 1000, // 5 minutes
                maxDeviationPercent: 10 // 10% deviation threshold
            };

            const validPrices = validateAndFilterPrices(pricesData, asset.name, validationConfig);

            if (validPrices.length > 0) {
                // Calculate average from valid prices only
                const prices = validPrices.map(pd => pd.price);
                const sources = validPrices.map(pd => pd.sourceName || 'unknown');
                const averagePrice = Math.floor(prices.reduce((sum, price) => sum + price, 0) / prices.length);

                assetPrices[asset.name] = averagePrice;
                assetAddresses[asset.name] = asset.targetAssetAddress;
                assetSources[asset.name] = sources;

                // Log if some sources were filtered out
                if (validPrices.length < pricesData.length) {
                    logInfo('CronScheduler',
                        `${asset.name}: Using ${validPrices.length}/${pricesData.length} sources after validation`
                    );
                }
            } else {
                logError('CronScheduler', new Error(
                    `${asset.name}: All ${pricesData.length} price sources failed validation`
                ));
            }
        }
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
