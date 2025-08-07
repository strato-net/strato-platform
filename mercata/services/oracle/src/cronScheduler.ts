import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { fetchGenericPrice, FeedConfig, SourceConfig } from './adapters/genericRestAdapter';
import { pushAssetPrices } from './utils/oraclePusher';
import { logFeedUpdate, logError, logInfo } from './utils/logger';

interface FeedsConfig {
    feeds: FeedConfig[];
}

interface SourcesConfig {
    [key: string]: SourceConfig;
}

// Load configurations dynamically to avoid Node.js caching
function loadConfig(): { feedsConfig: FeedsConfig; sourcesConfig: SourcesConfig } {
    const feedsPath = path.join(__dirname, 'config', 'feeds.json');
    const sourcesPath = path.join(__dirname, 'config', 'sources.json');

    const feedsConfig: FeedsConfig = JSON.parse(fs.readFileSync(feedsPath, 'utf8'));
    const sourcesConfig: SourcesConfig = JSON.parse(fs.readFileSync(sourcesPath, 'utf8'));

    return { feedsConfig, sourcesConfig };
}

export function startCronScheduler(): void {
    console.log(`=== Starting Oracle Service (Cron Mode, Batch Push) ===`);

    const { feedsConfig, sourcesConfig } = loadConfig();
    logInfo('CronScheduler', `Loaded ${feedsConfig.feeds.length} feeds from configuration`);

    for (const feed of feedsConfig.feeds) {
        const sourceConfig = sourcesConfig[feed.source];
        if (!sourceConfig) {
            logError('CronScheduler', new Error(`Unknown source: ${feed.source}`));
            continue;
        }

        console.log(`[CronScheduler] Scheduling ${feed.name} → cron: ${feed.cron}`);

        // Validate cron expression
        if (!cron.validate(feed.cron)) {
            logError('CronScheduler', new Error(`Invalid cron expression for ${feed.name}: ${feed.cron}`));
            continue;
        }

        cron.schedule(feed.cron, async () => {
            try {
                logInfo('CronScheduler', `Starting update for ${feed.name}`);

                // Reload configurations fresh for each execution
                const { feedsConfig: freshFeedsConfig, sourcesConfig: freshSourcesConfig } = loadConfig();
                const freshFeed = freshFeedsConfig.feeds.find(f => f.name === feed.name);
                if (!freshFeed) {
                    throw new Error(`Feed ${feed.name} not found in fresh config`);
                }
                const freshSourceConfig = freshSourcesConfig[freshFeed.source];

                const { price, feedTimestamp } = await fetchGenericPrice(freshFeed, freshSourceConfig);

                // Push to blockchain
                const result = await pushAssetPrices([freshFeed.targetAssetAddress], [price]);

                // Log success
                logFeedUpdate(freshFeed.name, price, feedTimestamp, result.hash);
                logInfo('CronScheduler', `Successfully updated ${freshFeed.name} with TX ${result.hash}`);

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