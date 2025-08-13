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
    
    // Remove private keys and addresses that might be sensitive
    message = message.replace(/0x[a-fA-F0-9]{64}/g, '0x***'); // Private keys
    message = message.replace(/0x[a-fA-F0-9]{40}/g, '0x***'); // Addresses (be careful with this)
    
    return message;
}

// Import health monitor for automatic error recording
import { healthMonitor } from './healthMonitor';

// Minimal logging functions - only for important events
export function logInfo(context: string, message: string): void {
    const sanitizedMessage = sanitizeLogMessage(message);
    const logTime = new Date().toISOString();
    console.log(`[INFO] ${logTime} | ${context} | ${sanitizedMessage}`);
}

export function logError(context: string, error: Error | string, additionalData?: any): void {
    const errorMessage = error instanceof Error ? error.message : error;
    const sanitizedMessage = sanitizeLogMessage(errorMessage);
    const logTime = new Date().toISOString();
    
    // Automatically record sanitized error to health monitor
    healthMonitor.recordFailure(sanitizedMessage);
    
    console.log(`[ERROR] ${logTime} | ${context} | ${sanitizedMessage}`);
    
    if (error instanceof Error && error.stack) {
        console.log(`[ERROR] ${logTime} | ${context} | Stack: ${sanitizeLogMessage(error.stack)}`);
    }
    
    if (additionalData) {
        console.log(`[ERROR] ${logTime} | ${context} | Additional Data: ${JSON.stringify(additionalData, null, 2)}`);
    }
}

// Bridge-specific logging for important operations only
export function logBridgeTransaction(
    context: string, 
    operation: 'bridgeOut' | 'bridgeIn' | 'withdrawal' | 'deposit',
    chainId: string,
    tokenAddress: string,
    amount: string,
    userAddress: string,
    txHash?: string,
    status?: string
): void {
    const logTime = new Date().toISOString();
    console.log(`\n[BridgeTx] ${logTime} | ${context}`);
    console.log(`├─ Operation: ${operation}`);
    console.log(`├─ Chain ID: ${chainId}`);
    console.log(`├─ Token: ${tokenAddress}`);
    console.log(`├─ Amount: ${amount}`);
    console.log(`├─ User: ${userAddress}`);
    if (txHash) console.log(`├─ TX Hash: ${txHash}`);
    if (status) console.log(`└─ Status: ${status}`);
    else console.log(`└─ Status: Pending`);
}

export function logChainSync(
    context: string,
    chainId: string,
    fromBlock: number,
    toBlock: number,
    eventsFound: number,
    processingTime: number
): void {
    const logTime = new Date().toISOString();
    console.log(`\n[ChainSync] ${logTime} | ${context}`);
    console.log(`├─ Chain ID: ${chainId}`);
    console.log(`├─ Block Range: ${fromBlock} → ${toBlock}`);
    console.log(`├─ Events Found: ${eventsFound}`);
    console.log(`└─ Processing Time: ${processingTime}ms`);
} 