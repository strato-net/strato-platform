import { healthMonitor } from "./healthMonitor";

// Utility function to sanitize sensitive data in log messages
function sanitizeLogMessage(message: string): string {
    // Remove API keys from URLs
    message = message.replace(/api_key=[^&\s]+/gi, 'api_key=***');
    message = message.replace(/apiKey=[^&\s]+/gi, 'apiKey=***');
    message = message.replace(/key=[^&\s]+/gi, 'key=***');
    
    // Remove Bearer tokens
    message = message.replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer ***');
    
    // Remove Authorization headers
    message = message.replace(/Authorization:\s*[^\s]+/gi, 'Authorization: ***');
    
    // Remove any URLs with API keys embedded
    message = message.replace(/https?:\/\/[^?\s]*\?[^?\s]*api_key[^?\s]*/gi, '***');
    message = message.replace(/https?:\/\/[^?\s]*\?[^?\s]*key[^?\s]*/gi, '***');
    
    return message;
}

// Enhanced logging functions with sanitization
export function logInfo(context: string, message: string): void {
    const sanitizedMessage = sanitizeLogMessage(message);
    const logTime = new Date().toISOString();
    console.log(`[INFO] ${logTime} | ${context} | ${sanitizedMessage}`);
}

export function logError(context: string, error: Error): void {
    const sanitizedMessage = sanitizeLogMessage(error.message);
    const logTime = new Date().toISOString();
    const error_message = `[ERROR] ${logTime} | ${context} | ${sanitizedMessage}`
    console.error(error_message);
    healthMonitor.appendToErrorFile(error_message).catch(err => {
        console.error("CRITICAL: Failed to write the error log. That is an unexpected server configuration error, so we exit(1):", err);
        process.exit(1);
    })
}

// Feed-specific logging with table format
export function logFeedUpdate(feedName: string, price: number, sources: Array<{name: string, price: number}>, onChainHash: string): void {
    const priceUSD = (price / 1e18).toFixed(8);
    const logTime = new Date().toISOString();
    
    console.log(`\n[FeedLogger] ${logTime} | ${feedName}`);
    console.log(`├─ Price: $${priceUSD} USD`);
    console.log(`├─ Transaction: ${onChainHash}`);
    console.log(`└─ Sources:`);
    sources.forEach((source, index) => {
        const sourcePrice = (source.price / 1e18).toFixed(8);
        const isLast = index === sources.length - 1;
        const prefix = isLast ? '    └─' : '    ├─';
        console.log(`${prefix} ${source.name}: $${sourcePrice} USD`);
    });
} 
