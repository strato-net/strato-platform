export function logFeedUpdate(feedName: string, price: number, feedTimestamp: string, onChainTimestamp: string): void {
    const logTime = new Date().toISOString();
    console.log(`[FeedLogger] ${logTime} | ${feedName} | price: ${price} | feedTimestamp: ${feedTimestamp} | onChainLastUpdated: ${onChainTimestamp}`);
}

export function logError(context: string, error: Error): void {
    const logTime = new Date().toISOString();
    console.error(`[ErrorLogger] ${logTime} | ${context} | ${error.message}`);
}

export function logInfo(context: string, message: string): void {
    const logTime = new Date().toISOString();
    console.log(`[InfoLogger] ${logTime} | ${context} | ${message}`);
} 