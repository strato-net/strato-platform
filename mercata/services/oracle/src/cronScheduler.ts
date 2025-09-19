import cron from 'node-cron';
import { logInfo, logError, logFeedUpdate } from './utils/logger';
import { fetchBatchPrices } from './adapters/genericRestAdapter';
import { pushAssetPrices, getUpdateInterval } from './utils/oraclePusher';
import { ConfigLoader } from './utils/configLoader';
import { healthMonitor } from './utils/healthMonitor';
import { Asset } from './types';

// Process all feeds in parallel and combine results
async function processAllFeeds(configLoader: ConfigLoader): Promise<void> {
    const resolvedFeeds = configLoader.getResolvedFeeds();
    
    // Process all feeds in parallel
    const feedPromises = resolvedFeeds.map(async (feed) => {
        try {
            return await processBatchFeed(feed, configLoader);
        } catch (err) {
            const error = err as Error;
            logError('CronScheduler', new Error(`${feed.name}: ${error.message}`));
            return null;
        }
    });

    const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Parallel feed processing timeout')), 60000)
    );
    
    try {
        const results = await Promise.race([
            Promise.allSettled(feedPromises),
            timeoutPromise
        ]) as PromiseSettledResult<any>[];
        
        // Collect all successful results
        const allAssetPrices: Record<string, number> = {};
        const allAssetAddresses: Record<string, string> = {};
        const allAssetSources: Record<string, string[]> = {};
        
        results.forEach((result) => {
            if (result.status === 'fulfilled' && result.value) {
                const { assetPrices, assetAddresses, assetSources } = result.value;
                
                // Merge results from all feeds
                Object.keys(assetPrices).forEach(assetName => {
                    allAssetPrices[assetName] = assetPrices[assetName];
                    allAssetAddresses[assetName] = assetAddresses[assetName];
                    allAssetSources[assetName] = assetSources[assetName];
                });
            }
        });
        
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
        
    } catch (timeoutError) {
        if (timeoutError instanceof Error && timeoutError.message === 'Parallel feed processing timeout') {
            logError('CronScheduler', new Error(`Feed processing timeout after 60000ms`));
        }
        throw timeoutError;
    }
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

    // Prepare parallel fetch tasks for batch sources
    const fetchTasks = resolvedFeed.sources.map(async (sourceName: string) => {
        try {
            const sourceConfig = configLoader.getSourceConfig(sourceName);
            const batchResult = await fetchBatchPrices(resolvedFeed.assets, sourceConfig);
            
            return { batchResult, source: sourceName, success: true };
            
        } catch (err) {
            const error = err as Error;
            return { batchResult: {}, source: sourceName, success: false, error: error.message };
        }
    });

    const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Parallel fetch timeout')), 30000)
    );
    
    try {
        const results = await Promise.race([
            Promise.allSettled(fetchTasks),
            timeoutPromise
        ]) as PromiseSettledResult<any>[];
        
        // Process batch results
        const allSuccessfulSources: Array<{name: string, prices: Record<string, number>}> = [];
        const failedSources: string[] = [];
        
        results.forEach((result) => {
            if (result.status === 'fulfilled' && (result as PromiseFulfilledResult<any>).value.success) {
                const value = (result as PromiseFulfilledResult<any>).value;
                allSuccessfulSources.push({
                    name: value.source,
                    prices: value.batchResult
                });
            } else {
                // Get the actual source name and error details
                let sourceName = 'unknown';
                let errorMessage = 'Unknown error';
                
                if (result.status === 'fulfilled') {
                    const value = (result as PromiseFulfilledResult<any>).value;
                    sourceName = value.source || 'unknown';
                    errorMessage = value.error || 'Unknown error';
                } else if (result.status === 'rejected') {
                    const reason = (result as PromiseRejectedResult).reason;
                    errorMessage = reason instanceof Error ? reason.message : String(reason);
                }
                
                failedSources.push(sourceName);
                logError('CronScheduler', new Error(`Failed to fetch ${feed.name} from ${sourceName}: ${errorMessage}`));
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

        // Calculate average prices for each asset across sources
        const assetPrices: Record<string, number> = {};
        const assetAddresses: Record<string, string> = {};
        const assetSources: Record<string, string[]> = {};
        
        resolvedFeed.assets.forEach((asset: Asset) => {
            const prices: number[] = [];
            const sources: string[] = [];
            
            allSuccessfulSources.forEach(source => {
                const assetResult = source.prices[asset.name] as any;
                if (assetResult && assetResult.price && assetResult.feedTimestamp) {
                    prices.push(assetResult.price);
                    sources.push(source.name);
                }
            });
            
            if (prices.length > 0) {
                const averagePrice = Math.floor(prices.reduce((sum, price) => sum + price, 0) / prices.length);
                
                assetPrices[asset.name] = averagePrice;
                assetAddresses[asset.name] = asset.targetAssetAddress;
                assetSources[asset.name] = sources;
            }
        });

        return { assetPrices, assetAddresses, assetSources };
        
    } catch (timeoutError) {
        if (timeoutError instanceof Error && timeoutError.message === 'Parallel fetch timeout') {
            logError('CronScheduler', new Error(`${feed.name}: Timeout after 30000ms`));
        }
        throw timeoutError;
    }
}

export async function startCronScheduler(): Promise<void> {
    const configLoader = new ConfigLoader();
    const resolvedFeeds = configLoader.getResolvedFeeds();
    
    // Read update interval from environment
    const updateIntervalSeconds = await getUpdateInterval();
    const updateIntervalMinutes = Math.ceil(updateIntervalSeconds / 60);
    
    logInfo('CronScheduler', `Starting Oracle Service with ${resolvedFeeds.length} feeds (update interval: ${updateIntervalMinutes} minutes from env: ${process.env.UPDATE_INTERVAL_MINUTES || '15'})`);

    // Single cron job that processes all feeds in parallel
    const jobFunction = async () => {
        try {
            await processAllFeeds(configLoader);
        } catch (err) {
            const error = err as Error;
            logError('CronScheduler', new Error(`Feed processing error: ${error.message}`));
        }
    };

    // Schedule the job based on update interval from contract
    const cronSchedule = `*/${updateIntervalMinutes} * * * *`;
    logInfo('CronScheduler', `Scheduling oracle updates every ${updateIntervalMinutes} minutes (cron: ${cronSchedule})`);
    
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
