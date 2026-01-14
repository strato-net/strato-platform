import { apiRequest } from '../utils/apiClient';
import { SourceConfig, BatchPriceResult, Asset } from '../types';
import { logError } from '../utils/logger';

// Helper functions for simplified configuration
function getApiKey(sourceConfig: SourceConfig): string {
    return sourceConfig.apiKeyEnvVar ? process.env[sourceConfig.apiKeyEnvVar] || '' : '';
}

export function extractNestedProperty(obj: any, path: string): any {
    if (!path) return undefined;
    // Use bracket notation to handle both object properties and array indices
    return path.split('.').reduce((o, key) => {
        // Convert array notation like "data[0]" to bracket notation
        const accessKey = key.replace(/\[(\d+)\]/g, '.$1');
        return accessKey.split('.').reduce((nested, k) => nested?.[k], o);
    }, obj);
}

export function generateConstantPrices(assets: Asset[]): BatchPriceResult {
    const result: BatchPriceResult = {};
    const timestamp = new Date().toISOString();
    
    assets.forEach(asset => {
        if (!asset.constantPrice) {
            throw new Error(`Asset ${asset.name} is configured for constant price but has no constantPrice field`);
        }
        
        result[asset.name] = {
            price: asset.constantPrice,
            feedTimestamp: timestamp
        };
    });
    
    return result;
} 

export async function fetchBatchPrices(assets: Asset[], sourceConfig: SourceConfig): Promise<BatchPriceResult> {
    const apiKey = getApiKey(sourceConfig);
    const url = buildBatchUrl(sourceConfig, assets, apiKey);
    const requestOptions = buildBatchRequestOptions(sourceConfig, url, apiKey, assets);

    const response = await apiRequest(requestOptions, {
        logPrefix: 'GenericRestAdapter',
        apiUrl: url,
        method: requestOptions.method || 'GET'
    });

    // Check for API error responses that don't throw HTTP errors
    if (response.data && response.data.success === false) {
        const errorMessage = response.data.error?.message || response.data.error || 'API returned error response';
        throw new Error(`${sourceConfig.url}: ${errorMessage}`);
    }

    return parseBatchResponse(response.data, sourceConfig, assets);
}

function buildBatchUrl(sourceConfig: SourceConfig, assets: Asset[], apiKey: string): string {
    let url = sourceConfig.url;
    
    // Replace API key placeholder
    if (apiKey) {
        url = url.replace(/\$\{API_KEY\}/g, apiKey);
    }
    
    // Add URL parameters
    if (sourceConfig.params) {
        const params = sourceConfig.params.split(',').map(p => p.trim());
        const queryParams = new URLSearchParams();
        
        params.forEach(param => {
            // API key params
            if ((param === 'api_key' || param === 'access_key' || param === 'x_cg_pro_api_key') && apiKey) {
                queryParams.append(param, apiKey);
            // Dynamic asset-based params
            } else if (param === 'ids') {
                const ids = assets.map(asset => {
                    const symbol = asset.name.split('-')[0];
                    return sourceConfig.symbolMapping?.[symbol] || symbol.toLowerCase();
                }).join(',');
                queryParams.append('ids', ids);
            } else if (param === 'symbol' || param === 'symbols') {
                const symbols = assets.map(asset => asset.name.split('-')[0]).join(',');
                queryParams.append(param, symbols);
            } else if (param === 'metals') {
                const metals = assets.map(asset => {
                    const symbol = asset.name.split('-')[0];
                    return sourceConfig.symbolMapping?.[symbol] || symbol;
                }).join(',');
                queryParams.append('metals', metals);
            // Static key=value params
            } else if (param.includes('=')) {
                const [key, value] = param.split('=');
                queryParams.append(key, value);
            }
        });
        
        if (queryParams.toString()) {
            url += '?' + queryParams.toString();
        }
    }
    
    return url;
}

function buildBatchRequestOptions(sourceConfig: SourceConfig, url: string, apiKey: string, assets: Asset[]): any {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    };

    // Add authorization headers
    if (sourceConfig.headers) {
        const headerNames = sourceConfig.headers.split(',').map(h => h.trim());
        headerNames.forEach(headerName => {
            if (headerName === 'X-CMC_PRO_API_KEY' && apiKey) {
                headers[headerName] = apiKey;
            }
        });
    }

    const requestOptions: any = {
        method: sourceConfig.method || 'GET',
        url,
        headers
    };

    // Handle POST request body
    if (sourceConfig.body && sourceConfig.method === 'POST') {
        if (sourceConfig.body === 'addresses') {
            requestOptions.data = {
                addresses: assets.map(asset => ({
                    network: "eth-mainnet",
                    address: asset.tokenAddress
                }))
            };
        }
    }

    return requestOptions;
}

/**
 * Parses batch API responses based on source configuration
 * Supports multiple response formats: array-based, object-based, and metals-specific
 */
function parseBatchResponse(
    data: any, 
    sourceConfig: SourceConfig, 
    assets: Asset[]
): BatchPriceResult {
    const result: BatchPriceResult = {};
    
    if (!assets || !Array.isArray(assets)) {
        throw new Error('Batch feed must have assets array');
    }
    
    const parsePattern = sourceConfig.parse;
    const timestampPattern = sourceConfig.timestamp;
    
    // Handle array-based responses (like Alchemy)
    if (parsePattern === 'data[].prices[0].value' && data.data && Array.isArray(data.data)) {
        data.data.forEach((item: any, index: number) => {
            const asset = assets[index];
            if (item.prices && item.prices.length > 0) {
                const priceUSD = parseFloat(item.prices[0].value);
                const price = Math.floor(priceUSD * 1e18);
                const feedTimestamp = item.prices[0].lastUpdatedAt || new Date().toISOString();
                result[asset.name] = { price, feedTimestamp };
            }
        });
        
    // Handle object-based responses with symbols as keys (like CoinMarketCap)
    } else if (parsePattern.includes('data.{symbol}[0].quote.USD.price') && data.data && typeof data.data === 'object') {
        assets.forEach(asset => {
            const symbol = asset.name.split('-')[0];
            const symbolData = data.data[symbol];
            if (symbolData && symbolData[0] && symbolData[0].quote && symbolData[0].quote.USD) {
                const priceUSD = parseFloat(symbolData[0].quote.USD.price);
                const price = Math.floor(priceUSD * 1e18);
                const feedTimestamp = symbolData[0].quote.USD.last_updated || new Date().toISOString();
                result[asset.name] = { price, feedTimestamp };
            }
        });
        
    // Handle CoinGecko response structures
    } else if (parsePattern === '{id}.usd') {
        assets.forEach(asset => {
            const symbol = asset.name.split('-')[0];
            const id = sourceConfig.symbolMapping?.[symbol] || symbol.toLowerCase();
            const priceData = data[id];
            
            if (priceData && priceData.usd) {
                const priceUSD = parseFloat(priceData.usd);
                const price = Math.floor(priceUSD * 1e18);
                const feedTimestamp = priceData.last_updated_at 
                    ? new Date(priceData.last_updated_at * 1000).toISOString()
                    : new Date().toISOString();
                result[asset.name] = { price, feedTimestamp };
            }
        });
        
    // Handle metals-specific response structures
    } else if (parsePattern.includes('metals.{metal}') || parsePattern.includes('rates.USD{symbol}')) {
        assets.forEach(asset => {
            let priceUSD: number;
            let feedTimestamp: string;
            
            if (parsePattern.includes('metals.{metal}')) {
                // Metals.dev format
                const symbol = asset.name.split('-')[0];
                const metalKey = sourceConfig.symbolMapping?.[symbol] || symbol;
                priceUSD = parseFloat(data.metals[metalKey]);
                feedTimestamp = data.timestamps?.metal || new Date().toISOString();
            } else {
                // MetalPriceAPI format
                const symbol = asset.name.split('-')[0];
                const rateKey = `USD${symbol}`;
                priceUSD = parseFloat(data.rates[rateKey]);
                feedTimestamp = data.timestamp ? new Date(data.timestamp * 1000).toISOString() : new Date().toISOString();
            }
            
            if (!isNaN(priceUSD)) {
                const price = Math.floor(priceUSD * 1e18);
                result[asset.name] = { price, feedTimestamp };
            }
        });
        
    // Generic fallback for other response formats
    } else {
        assets.forEach(asset => {
            try {
                const symbol = asset.name.split('-')[0];
                const assetParsePath = parsePattern.replace(/\{symbol\}/g, symbol);
                const priceUSD = extractNestedProperty(data, assetParsePath);
                
                if (priceUSD && !isNaN(parseFloat(priceUSD))) {
                    const price = Math.floor(parseFloat(priceUSD) * 1e18);
                    const feedTimestamp = timestampPattern 
                        ? extractNestedProperty(data, timestampPattern) || new Date().toISOString()
                        : new Date().toISOString();
                    result[asset.name] = { price, feedTimestamp };
                }
            } catch (error) {
                logError('GenericRestAdapter', new Error(`Failed to parse price for ${asset.name}: ${error}`));
            }
        });
    }
    
    return result;
} 