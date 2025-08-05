import cron from 'node-cron';
import { fetchGenericPrice } from './adapters/genericRestAdapter';
import { pushAssetPrices } from './utils/oraclePusher';
import { logFeedUpdate, logError, logInfo } from './utils/logger';
import * as feedsConfig from './config/feeds.json';
import * as sourcesConfig from './config/sources.json';
import { SourceConfig } from './types';

export function startCronScheduler(): void {
    logInfo('CronScheduler', '=== Starting Oracle Service (Cron Mode, Batch Push) ===');
    logInfo('CronScheduler', `Loaded ${feedsConfig.feeds.length} feeds from configuration`);

    for (const feed of feedsConfig.feeds) {
        logInfo('CronScheduler', `Scheduling ${feed.name} → cron: ${feed.cron}`);

        cron.schedule(feed.cron, async () => {
            try {
                logInfo('CronScheduler', `Starting update for ${feed.name}`);
                
                // Prepare parallel fetch tasks
                const fetchTasks = feed.sources.map(async (source) => {
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
                            apiParams: feed.tokenAddress 
                                ? { tokenAddress: feed.tokenAddress }
                                : (source as any).apiParams || { symbol: feed.symbol }
                        };

                        const { price, feedTimestamp } = await fetchGenericPrice(feedConfig, sourceConfig);
                        
                        logInfo('CronScheduler', `${feed.name} from ${source.name}: ${(price / 1e18).toFixed(8)} USD`);
                        
                        return { price, feedTimestamp, source: source.name, success: true };
                        
                    } catch (err) {
                        const error = err as Error;
                        const errorType = error.message.includes('network') ? 'Network' : 
                                        error.message.includes('timeout') ? 'Timeout' :
                                        error.message.includes('Invalid price') ? 'Data Validation' :
                                        error.message.includes('API') ? 'API' : 'Unknown';
                        
                        logError('CronScheduler', new Error(`[${errorType}] Error fetching ${feed.name} from ${source.name}: ${error.message}`));
                        logInfo('CronScheduler', `Skipping ${source.name} for ${feed.name} due to ${errorType.toLowerCase()} error`);
                        
                        return { price: 0, feedTimestamp: '', source: source.name, success: false, error: error.message };
                    }
                });

                // Execute all fetches in parallel with timeout
                logInfo('CronScheduler', `Fetching ${feed.name} from ${feed.sources.length} sources in parallel...`);
                const timeoutMs = 30000; // 30 second timeout
                const startTime = Date.now();
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Parallel fetch timeout')), timeoutMs)
                );
                
                try {
                    const results = await Promise.race([
                        Promise.allSettled(fetchTasks),
                        timeoutPromise
                    ]) as PromiseSettledResult<any>[];
                    
                    // Process results
                    const prices: number[] = [];
                    const timestamps: string[] = [];
                    const successfulSources: string[] = [];
                    const failedSources: string[] = [];
                    
                    results.forEach((result, index) => {
                        const sourceName = feed.sources[index].name;
                        
                        if (result.status === 'fulfilled' && result.value.success) {
                            prices.push(result.value.price);
                            timestamps.push(result.value.feedTimestamp);
                            successfulSources.push(sourceName);
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

                    // Log success with parallel fetch summary
                    const fetchDuration = Date.now() - startTime;
                    logFeedUpdate(feed.name, averagePrice, latestTimestamp, result.hash);
                    logInfo('CronScheduler', `✅ ${feed.name}: Successfully fetched from ${successfulSources.length}/${feed.sources.length} sources in ${fetchDuration}ms`);
                    logInfo('CronScheduler', `   Successful: ${successfulSources.join(', ')}`);
                    if (failedSources.length > 0) {
                        logInfo('CronScheduler', `   Failed: ${failedSources.join(', ')}`);
                    }
                    logInfo('CronScheduler', `   Average price: ${(averagePrice / 1e18).toFixed(8)} USD, TX: ${result.hash}`);
                    
                } catch (timeoutError) {
                    if (timeoutError instanceof Error && timeoutError.message === 'Parallel fetch timeout') {
                        logError('CronScheduler', new Error(`Parallel fetch timeout for ${feed.name} after ${timeoutMs}ms`));
                        throw new Error(`Timeout: No prices received for ${feed.name} within ${timeoutMs}ms`);
                    }
                    throw timeoutError;
                }

            } catch (err) {
                const error = err as Error;
                logError('CronScheduler', new Error(`Error updating ${feed.name}: ${error.message}`));
                logInfo('CronScheduler', `Feed ${feed.name} update failed, will retry on next cron cycle`);
            }
        });
    }

    logInfo('CronScheduler', 'All cron jobs scheduled successfully');
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