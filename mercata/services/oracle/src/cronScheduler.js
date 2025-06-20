const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { fetchGenericPrice } = require('./adapters/genericRestAdapter');
const { pushAssetPrices } = require('./utils/oraclePusher');
const { logFeedUpdate, logError, logInfo } = require('./utils/logger');

// Load configurations dynamically to avoid Node.js caching
function loadConfig() {
    const feedsPath = path.join(__dirname, 'config', 'feeds.json');
    const sourcesPath = path.join(__dirname, 'config', 'sources.json');
    
    const feedsConfig = JSON.parse(fs.readFileSync(feedsPath, 'utf8'));
    const sourcesConfig = JSON.parse(fs.readFileSync(sourcesPath, 'utf8'));
    
    return { feedsConfig, sourcesConfig };
}

function startCronScheduler() {
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
                const freshSourceConfig = freshSourcesConfig[freshFeed.source];
                
                const { price, feedTimestamp } = await fetchGenericPrice(freshFeed, freshSourceConfig);

                // Push to blockchain
                const result = await pushAssetPrices([freshFeed.targetAssetAddress], [price]);

                // Log success
                logFeedUpdate(freshFeed.name, price, feedTimestamp, result.txHash);
                logInfo('CronScheduler', `Successfully updated ${freshFeed.name} with TX ${result.txHash}`);

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