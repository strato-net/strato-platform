import cron from 'node-cron';
import { fetchGenericPrice } from './adapters/genericRestAdapter';
import { pushAssetPrices } from './utils/oraclePusher';
import { logFeedUpdate, logError, logInfo } from './utils/logger';
const feedsConfig = require('./config/feeds.json');
const sourcesConfig = require('./config/sources.json');
import { SourceConfig } from './types';

function buildApiParams(sourceConfig: SourceConfig, feed: any, source: any): Record<string, any> {
    const params: Record<string, any> = {};
    
    // Check what parameters the source expects based on its configuration
    const urlTemplate = sourceConfig.urlTemplate || '';
    const parsePath = sourceConfig.parsePath || '';
    
    // Check for tokenAddress parameter
    if (urlTemplate.includes('${tokenAddress}') || parsePath.includes('${tokenAddress}')) {
        if (feed.tokenAddress) {
            params.tokenAddress = feed.tokenAddress;
        }
    }
    
    // Check for symbol parameter
    if (urlTemplate.includes('${symbol}') || parsePath.includes('${symbol}')) {
        if (feed.symbol) {
            params.symbol = feed.symbol;
        }
    }
    
    // Check for metal parameter (for metals feeds)
    if (urlTemplate.includes('${metal}') || parsePath.includes('${metal}')) {
        if (source.apiParams?.metal) {
            params.metal = source.apiParams.metal;
        }
    }
    
    // If no parameters were found, fall back to the original logic
    if (Object.keys(params).length === 0) {
        if (feed.tokenAddress) {
            params.tokenAddress = feed.tokenAddress;
        } else if (feed.symbol) {
            params.symbol = feed.symbol;
        } else if (source.apiParams) {
            Object.assign(params, source.apiParams);
        }
    }
    
    return params;
}

export function startCronScheduler(): void {
    logInfo('CronScheduler', `Starting Oracle Service with ${feedsConfig.feeds.length} feeds`);

    for (const feed of feedsConfig.feeds) {
        // Create the job function
        const jobFunction = async () => {
            try {
                // Prepare parallel fetch tasks
                const fetchTasks = feed.sources.map(async (source: any) => {
                    try {
                        const sourceConfig = sourcesConfig[source.name as keyof typeof sourcesConfig] as SourceConfig;
                        if (!sourceConfig) {
                            throw new Error(`Unknown source: ${source.name}`);
                        }

                        const feedConfig = {
                            name: `${feed.name}-${source.name}`,
                            source: source.name,
                            targetAssetAddress: feed.targetAssetAddress,
                            cron: feed.cron,
                            apiParams: buildApiParams(sourceConfig, feed, source)
                        };

                        const { price, feedTimestamp } = await fetchGenericPrice(feedConfig, sourceConfig);
                        
                        return { price, feedTimestamp, source: source.name, success: true };
                        
                    } catch (err) {
                        const error = err as Error;
                        logError('CronScheduler', new Error(`${feed.name} from ${source.name}: ${error.message}`));
                        return { price: 0, feedTimestamp: '', source: source.name, success: false, error: error.message };
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
                    
                    // Process results
                    const prices: number[] = [];
                    const timestamps: string[] = [];
                    const successfulSources: Array<{name: string, price: number}> = [];
                    const failedSources: string[] = [];
                    
                    results.forEach((result, index) => {
                        const sourceName = feed.sources[index].name;
                        
                        if (result.status === 'fulfilled' && result.value.success) {
                            prices.push(result.value.price);
                            timestamps.push(result.value.feedTimestamp);
                            successfulSources.push({name: sourceName, price: result.value.price});
                        } else {
                            const error = result.status === 'rejected' ? result.reason : result.value?.error || 'Unknown error';
                            failedSources.push(sourceName);
                            logError('CronScheduler', new Error(`Failed to fetch ${feed.name} from ${sourceName}: ${error}`));
                        }
                    });
                    
                    if (prices.length === 0) {
                        throw new Error(`No valid prices received for ${feed.name} from any source`);
                    }

                    // Calculate average price from all sources
                    const averagePrice = Math.floor(prices.reduce((sum, price) => sum + price, 0) / prices.length);
                    const latestTimestamp = timestamps.sort().pop() || new Date().toISOString();

                    // Push to blockchain
                    const result = await pushAssetPrices([feed.targetAssetAddress], [averagePrice]);

                    // Log success with source breakdown
                    logFeedUpdate(feed.name, averagePrice, successfulSources, result.hash);
                    
                } catch (timeoutError) {
                    if (timeoutError instanceof Error && timeoutError.message === 'Parallel fetch timeout') {
                        logError('CronScheduler', new Error(`${feed.name}: Timeout after 30000ms`));
                    }
                    throw timeoutError;
                }

            } catch (err) {
                const error = err as Error;
                logError('CronScheduler', new Error(`${feed.name}: ${error.message}`));
            }
        };

        // Schedule the job
        cron.schedule(feed.cron, jobFunction);
        
        // Run the job immediately on startup
        setTimeout(() => {
            jobFunction();
        }, 1000); // Small delay to ensure everything is initialized
    }
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