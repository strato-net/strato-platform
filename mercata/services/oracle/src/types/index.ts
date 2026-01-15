export interface Asset {
    targetAssetAddress: string;
    constantPrice?: number;
    weekendProxy?: string; // Proxy symbol for weekend/market-closed pricing (e.g., "PAXG" for XAU)
}

// Asset with its key attached for processing
export interface ResolvedAsset extends Asset {
    key: string; // Asset identifier (ETH, WBTC, XAU, etc.)
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
    timestamp?: string; // Timestamp parsing pattern
    batchMode?: boolean;
    apiKeyEnvVar?: string; // Environment variable name for API key
    symbolMapping?: Record<string, string>; // Mapping from asset symbols to API-specific keys
    assets: string[]; // Which assets this source supports
}

export interface SourcesConfig {
    [key: string]: SourceConfig;
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

// Schedule types for asset processing
export type AssetSchedule = 'always' | 'metals' | 'constant';

export interface AssetsBySchedule {
    always: string[];   // Crypto assets - always process
    metals: string[];   // Assets with weekendProxy - use proxy when market closed
    constant: string[]; // Assets with constantPrice - use fixed price
}
