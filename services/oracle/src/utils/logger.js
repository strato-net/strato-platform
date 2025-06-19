function logFeedUpdate(feedName, price, feedTimestamp, onChainTimestamp) {
    const logTime = new Date().toISOString();
    console.log(`[FeedLogger] ${logTime} | ${feedName} | price: ${price} | feedTimestamp: ${feedTimestamp} | onChainLastUpdated: ${onChainTimestamp}`);
}

function logError(context, error) {
    const logTime = new Date().toISOString();
    console.error(`[ErrorLogger] ${logTime} | ${context} | ${error.message}`);
}

function logInfo(context, message) {
    const logTime = new Date().toISOString();
    console.log(`[InfoLogger] ${logTime} | ${context} | ${message}`);
}

module.exports = { logFeedUpdate, logError, logInfo }; 