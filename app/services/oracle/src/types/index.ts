export interface RebaseConfig {
    underlyingAsset: string;      // Asset key whose aggregated price is the base (e.g., "SPY")
    factorUrl: string;            // REST endpoint to fetch the rebase factor (supports ${STRATO_NODE_URL}, ${API_KEY} substitution)
    factorMethod?: string;        // HTTP method; defaults to GET. Use POST for JSON-RPC eth_call.
    factorBody?: string;          // JSON body template for POST requests
    factorParse: string;          // JSON path to extract the factor value (e.g., "result" for eth_call hex response)
    factorPrecision: string;      // Divisor for the raw factor: "1000000000000000000000000000" for ray, "1000000000000000000" for wad
    factorApiKeyEnvVar?: string;
    factorHeaders?: string;       // Comma-separated header names that receive the resolved API key
}

export interface ExchangeRateConfig {
    rateUrl: string;             // REST endpoint (e.g. Alchemy eth_call)
    rateMethod?: string;         // HTTP method; defaults to GET. Use POST for JSON-RPC.
    rateBody?: string;           // JSON body template for POST requests
    rateParse: string;           // JSON path to extract the rate value (e.g., "result")
    ratePrecision: string;       // Native precision of the raw value: "1000000000000000000" for WAD, "1000000" for 6-decimal
    rateApiKeyEnvVar?: string;   // Environment variable for API key
    rateHeaders?: string;        // Comma-separated header names
}

export interface Asset {
    targetAssetAddress: string;
    targetAssetAddressTestnet?: string; // used when ORACLE_IS_TESTNET=true
    constantPrice?: number;
    weekendProxy?: string; // Proxy symbol for weekend/market-closed pricing (e.g., "PAXG" for XAU)
    equivalentAssets?: string[]; // Assets with equivalent prices (e.g., ["XAUT"] for XAU)
    submit?: boolean; // Whether to submit this asset to blockchain (default: true)
    rebase?: RebaseConfig; // Rebasing token config: price = underlyingPrice × factor / precision
    exchangeRate?: ExchangeRateConfig; // On-chain exchange rate for yield-bearing tokens
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
    accountIdEnvVar?: string; // Environment variable name for account ID (e.g., OANDA)
    accountId?: string; // Resolved account ID (populated at load time)
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
