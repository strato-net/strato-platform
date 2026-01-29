export interface Asset {
    targetAssetAddress: string;
    constantPrice?: number;
    weekendProxy?: string; // Proxy symbol for weekend/market-closed pricing (e.g., "PAXG" for XAU)
    submit?: boolean; // Whether to submit this asset to blockchain (default: true)
}

export interface BatchPriceResult {
    [assetName: string]: {
        price: number;
        feedTimestamp: string;
    };
}

export interface SourceConfig {
    url?: string; // Optional for constant source
    method?: string;
    params?: string; // Comma-separated URL parameters
    headers?: string; // Comma-separated header names
    body?: string; // Request body key
    parse: string; // Price parsing pattern
    apiKeyEnvVar?: string; // Environment variable name for API key
    apiKey?: string; // Resolved API key (populated at load time)
    symbolMapping?: Record<string, string>; // Mapping from asset symbols to API-specific keys
    assets: string[]; // Which assets this source supports
}

export interface TransactionResult {
    hash: string;
    status: string;
    timestamp?: string;
}

export interface CallListArg {
    contract: { address: string; name: string };
    method: string;
    args: Record<string, any>;
}

export interface RetryConfig {
    maxAttempts: number;
    logPrefix: string;
    apiUrl?: string;
    method?: string;
} 

export interface TxMetric {
    txHash: string;         // Transaction hash (for logging)
    duration: number;       // Time from submit to confirm (ms)
    status: string;         // "Success" or "Failure"
}

export interface SourceResult {
    sourceName: string;
    prices: Record<string, { price: number; feedTimestamp: string }>;
    success: boolean;
    duration: number;
}

export interface AggregatedPrice {
    assetKey: string;
    medianPrice: number;
    targetAddress: string;
    sources: Array<{ name: string; price: number }>;
    expectedSourceCount: number;
    failed?: boolean;
    error?: string;
}

