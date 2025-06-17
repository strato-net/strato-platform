const cron = require('node-cron');
const { fetchGenericPrice } = require('./adapters/genericRestAdapter');
const { pushAssetPrices } = require('./utils/oraclePusher');
const { logFeedUpdate, logError, logInfo } = require('./utils/logger');
const feedsConfig = require('./config/feeds.json');
const sourcesConfig = require('./config/sources.json');

function startCronScheduler() {
    console.log(`=== Starting Oracle Service (Cron Mode, Batch Push) ===`);
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
                
                const { price, feedTimestamp } = await fetchGenericPrice(feed, sourceConfig);

                // Validate against min/max
                const minPrice = feed.minPrice || 1e6; // Default $0.01
                const maxPrice = feed.maxPrice || 1e12 * 1e8; // Default $10T

                if (price < minPrice) {
                    throw new Error(`Price below minPrice: ${price} < ${minPrice}`);
                }
                if (price > maxPrice) {
                    throw new Error(`Price exceeds maxPrice: ${price} > ${maxPrice}`);
                }

                // Push to blockchain
                const result = await pushAssetPrices([feed.targetAssetAddress], [price]);

                // Log success
                logFeedUpdate(feed.name, price, feedTimestamp, result.blockNumber);
                logInfo('CronScheduler', `Successfully updated ${feed.name} in block ${result.blockNumber}`);

            } catch (err) {
                logError('CronScheduler', new Error(`Error updating ${feed.name}: ${err.message}`));
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

module.exports = { startCronScheduler }; 