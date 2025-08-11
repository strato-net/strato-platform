export interface Asset {
    name: string;
    tokenAddress?: string;
    targetAssetAddress: string;
}

export interface BatchPriceResult {
    [assetName: string]: {
        price: number;
        feedTimestamp: string;
    };
}

export interface FeedConfig {
    name: string;
    sources: string[];
    assets: string[]; // Array of asset keys
    minPrice?: number;
    maxPrice?: number;
}

export interface SourceConfig {
    url: string;
    method?: string;
    params?: string; // Comma-separated URL parameters
    headers?: string; // Comma-separated header names
    body?: string; // Request body key
    parse: string; // Price parsing pattern
    timestamp?: string; // Timestamp parsing pattern
    batchMode?: boolean;
    apiKeyEnvVar?: string; // Environment variable name for API key
    symbolMapping?: Record<string, string>; // Mapping from asset symbols to API-specific keys
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
} 