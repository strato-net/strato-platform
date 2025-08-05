export function logFeedUpdate(feedName: string, price: number, feedTimestamp: string, onChainTimestamp: string): void {
    const logTime = new Date().toISOString();
    console.log(`[FeedLogger] ${logTime} | ${feedName} | price: ${price} | feedTimestamp: ${feedTimestamp} | onChainLastUpdated: ${onChainTimestamp}`);
}

export function logError(context: string, error: Error): void {
    const logTime = new Date().toISOString();
    console.error(`[ERROR] ${logTime} | ${context} | ${error.message}`);
}

export function logInfo(context: string, message: string): void {
    const logTime = new Date().toISOString();
    console.log(`[INFO] ${logTime} | ${context} | ${message}`);
}

export function logWarn(context: string, message: string): void {
    const logTime = new Date().toISOString();
    console.warn(`[WARN] ${logTime} | ${context} | ${message}`);
}

export function logDebug(context: string, message: string): void {
    const logTime = new Date().toISOString();
    console.log(`[DEBUG] ${logTime} | ${context} | ${message}`);
} 