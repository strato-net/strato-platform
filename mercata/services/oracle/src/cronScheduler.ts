import cron from 'node-cron';
import { fetchGenericPrice } from './adapters/genericRestAdapter';
import { pushAssetPrices } from './utils/oraclePusher';
import { logFeedUpdate, logError, logInfo } from './utils/logger';
import * as feedsConfig from './config/feeds.json';
import * as sourcesConfig from './config/sources.json';

export function startCronScheduler(): void {
    logInfo('CronScheduler', '=== Starting Oracle Service (Cron Mode, Batch Push) ===');
    logInfo('CronScheduler', `Loaded ${feedsConfig.feeds.length} feeds from configuration`);

    for (const feed of feedsConfig.feeds) {
        const sourceConfig = sourcesConfig[feed.source as keyof typeof sourcesConfig];
        if (!sourceConfig) {
            logError('CronScheduler', new Error(`Unknown source: ${feed.source}`));
            continue;
        }

        logInfo('CronScheduler', `Scheduling ${feed.name} → cron: ${feed.cron}`);

        cron.schedule(feed.cron, async () => {
            try {
                logInfo('CronScheduler', `Starting update for ${feed.name}`);
                
                const { price, feedTimestamp } = await fetchGenericPrice(feed, sourceConfig);

                // Push to blockchain
                const result = await pushAssetPrices([feed.targetAssetAddress], [price]);

                // Log success
                logFeedUpdate(feed.name, price, feedTimestamp, result.hash);
                logInfo('CronScheduler', `Successfully updated ${feed.name} with TX ${result.hash}`);

            } catch (err) {
                logError('CronScheduler', new Error(`Error updating ${feed.name}: ${(err as Error).message}`));
            }
        });
    }

    logInfo('CronScheduler', 'All cron jobs scheduled successfully');
}

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n[CronScheduler] Received SIGINT, shutting down gracefully...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n[CronScheduler] Received SIGTERM, shutting down gracefully...');
    process.exit(0);
}); 