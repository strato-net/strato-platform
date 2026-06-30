import { healthMonitor } from "./healthMonitor";
import { sendWarningToSlack, sendErrorToSlack } from "./slackNotifier";

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

export function logWarning(context: string, message: string): void {
    const sanitizedMessage = sanitizeLogMessage(message);
    const logTime = new Date().toISOString();
    const warning_message = `[WARNING] ${logTime} | ${context} | ${sanitizedMessage}`;
    console.warn(`\x1b[33m${warning_message}\x1b[0m`); // Yellow color
    healthMonitor.appendToWarningFile(warning_message).catch(err => {
        console.error("Failed to write to warning file:", err);
    });
    sendWarningToSlack(context, sanitizedMessage, logTime).catch(err => {
        logError('SlackNotifier', err instanceof Error ? err : new Error(String(err)));
    });
}

export function logError(context: string, error: Error): void {
    const sanitizedMessage = sanitizeLogMessage(error.message);
    const logTime = new Date().toISOString();
    const error_message = `[ERROR] ${logTime} | ${context} | ${sanitizedMessage}`
    console.error(`\x1b[31m${error_message}\x1b[0m`); // Red color
    healthMonitor.appendToErrorFile(error_message).catch(err => {
        console.error("CRITICAL: Failed to write the error log. That is an unexpected server configuration error, so we exit(1):", err);
        process.exit(1);
    })
    sendErrorToSlack(context, sanitizedMessage, logTime).catch(err => {
        // Log to console only - do not call logError here to avoid infinite recursion
        console.error(`Failed to send error to Slack: ${err instanceof Error ? err.message : String(err)}`);
    })
}

// Feed-specific logging with table format
export function logFeedUpdate(feedName: string, price: number, sources: Array<{name: string, price: number}>, expectedSourceCount: number, onChainHash: string, failed?: boolean, error?: string): void {
    const logTime = new Date().toISOString();
    
    if (failed) {
        // Red color for failed feeds (not enough sources to submit)
        console.log(`\x1b[31m\n[FeedLogger] ${logTime} | ${feedName}`);
        console.log(`├─ Price: ${error || 'Not enough sources'}`);
        console.log(`├─ Sources: ${sources.length}/${expectedSourceCount}`);
        console.log(`├─ Transaction: N/A`);
        if (sources.length > 0) {
            console.log(`└─ Source Prices:`);
            sources.forEach((source, index) => {
                const sourcePrice = (source.price / 1e18).toFixed(8);
                const isLast = index === sources.length - 1;
                const prefix = isLast ? '    └─' : '    ├─';
                console.log(`${prefix} ${source.name}: $${sourcePrice} USD`);
            });
        } else {
            console.log(`└─ No sources available`);
        }
        console.log(`\x1b[0m`); // Reset color
    } else {
        const priceUSD = (price / 1e18).toFixed(8);
        const missingSources = sources.length < expectedSourceCount;
        
        if (missingSources) {
            // Yellow color for successful feeds with missing sources
            console.log(`\x1b[33m\n[FeedLogger] ${logTime} | ${feedName}`);
            console.log(`├─ Price: $${priceUSD} USD`);
            console.log(`├─ Sources: ${sources.length}/${expectedSourceCount}`);
            console.log(`├─ Transaction: ${onChainHash}`);
            console.log(`└─ Source Prices:`);
            sources.forEach((source, index) => {
                const sourcePrice = (source.price / 1e18).toFixed(8);
                const isLast = index === sources.length - 1;
                const prefix = isLast ? '    └─' : '    ├─';
                console.log(`${prefix} ${source.name}: $${sourcePrice} USD`);
            });
            console.log(`\x1b[0m`); // Reset color
        } else {
            // Normal color for successful feeds with all sources
            console.log(`\n[FeedLogger] ${logTime} | ${feedName}`);
            console.log(`├─ Price: $${priceUSD} USD`);
            console.log(`├─ Sources: ${sources.length}/${expectedSourceCount}`);
            console.log(`├─ Transaction: ${onChainHash}`);
            console.log(`└─ Source Prices:`);
            sources.forEach((source, index) => {
                const sourcePrice = (source.price / 1e18).toFixed(8);
                const isLast = index === sources.length - 1;
                const prefix = isLast ? '    └─' : '    ├─';
                console.log(`${prefix} ${source.name}: $${sourcePrice} USD`);
            });
        }
    }
} 
