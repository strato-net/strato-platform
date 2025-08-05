export interface SourceConfig {
    name?: string;
    apiKeyEnvVar?: string;
    apiKeyType?: 'bearer' | 'url' | 'header';
    urlTemplate: string;
    parsePath: string;
    feedTimestampPath?: string;
    headers?: Record<string, string>;
    method?: string;
    requestBody?: any;
}

export interface FeedConfig {
    name: string;
    source: string;
    targetAssetAddress: string;
    cron: string;
    apiParams: Record<string, any>;
    minPrice?: number;
    maxPrice?: number;
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