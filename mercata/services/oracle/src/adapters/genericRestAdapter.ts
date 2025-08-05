import axios from 'axios';
import { logError } from '../utils/logger';
import { SourceConfig, BatchPriceResult, Asset } from '../types';

export async function fetchGenericPrice(asset: Asset, sourceConfig: SourceConfig): Promise<{
    price: number;
    feedTimestamp: string;
}> {
    try {
        const apiKey = getApiKey(sourceConfig);
        const url = buildUrl(sourceConfig, asset, apiKey);
        const requestOptions = buildRequestOptions(sourceConfig, url, apiKey, asset);
        
        const response = await axios(requestOptions);
        
        const priceUSD = extractPrice(response.data, sourceConfig, asset);
        const feedTimestamp = extractTimestamp(response.data, sourceConfig);

        if (!priceUSD || isNaN(parseFloat(priceUSD))) {
            throw new Error(`Invalid price data received for ${asset.name}: ${priceUSD}`);
        }

        const price = Math.floor(parseFloat(priceUSD) * 1e18);
        return { price, feedTimestamp };

    } catch (error) {
        logError('GenericAdapter', error as Error);
        throw error;
    }
}

// Helper functions for simplified configuration
function getApiKey(sourceConfig: SourceConfig): string {
    return sourceConfig.apiKeyEnvVar ? process.env[sourceConfig.apiKeyEnvVar] || '' : '';
}

function buildUrl(sourceConfig: SourceConfig, asset: Asset, apiKey: string): string {
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
            if (param === 'api_key' && apiKey) {
                queryParams.append('api_key', apiKey);
            } else if (param === 'symbol') {
                queryParams.append('symbol', asset.name.split('-')[0]); // Extract symbol from asset name
            } else if (param.startsWith('currency=')) {
                queryParams.append('currency', param.split('=')[1]);
            } else if (param.startsWith('convert=')) {
                queryParams.append('convert', param.split('=')[1]);
            } else if (param.startsWith('base=')) {
                queryParams.append('base', param.split('=')[1]);
            } else if (param.startsWith('currencies=')) {
                queryParams.append('currencies', param.split('=')[1]);
            } else if (param.startsWith('unit=')) {
                queryParams.append('unit', param.split('=')[1]);
            }
        });
        
        if (queryParams.toString()) {
            url += '?' + queryParams.toString();
        }
    }
    
    return url;
}

function buildRequestOptions(sourceConfig: SourceConfig, url: string, apiKey: string, asset: Asset): any {
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
                addresses: [{
                    network: "eth-mainnet",
                    address: asset.tokenAddress
                }]
            };
        }
    }

    return requestOptions;
}

function extractPrice(data: any, sourceConfig: SourceConfig, asset: Asset): string {
    const parsePattern = sourceConfig.parse;
    let pricePath = parsePattern;
    
    // Replace placeholders in parse pattern
    if (parsePattern.includes('{symbol}')) {
        const symbol = asset.name.split('-')[0];
        pricePath = parsePattern.replace(/\{symbol\}/g, symbol);
    } else if (parsePattern.includes('{metal}')) {
        const metal = asset.name.split('-')[0] === 'XAU' ? 'gold' : 'silver';
        pricePath = parsePattern.replace(/\{metal\}/g, metal);
    }
    
    return extractNestedProperty(data, pricePath);
}

function extractTimestamp(data: any, sourceConfig: SourceConfig): string {
    if (!sourceConfig.timestamp) {
        return new Date().toISOString();
    }
    
    return extractNestedProperty(data, sourceConfig.timestamp) || new Date().toISOString();
}

function replacePlaceholders(template: string, params: Record<string, any>, apiKey: string = ''): string {
    let result = template;
    
    // Replace API parameters
    for (const [key, value] of Object.entries(params)) {
        if (typeof value === 'object') {
            // Handle object parameters (like addresses array)
            result = result.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), JSON.stringify(value));
        } else {
            result = result.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), String(value));
        }
    }
    
    // Replace API key
    if (apiKey) {
        result = result.replace(/\$\{API_KEY\}/g, apiKey);
    }
    
    return result;
}

/**
 * Recursively replaces placeholders in objects, arrays, and strings
 * Handles special cases like exact placeholder matches for object values
 */
function replacePlaceholdersInObject(obj: any, params: Record<string, any>, apiKey: string = ''): any {
    if (typeof obj === 'string') {
        let result = obj;
        
        for (const [key, value] of Object.entries(params)) {
            if (typeof value === 'object') {
                // Handle exact placeholder matches for object values
                if (result === `\${${key}}`) {
                    return value;
                } else {
                    result = result.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), JSON.stringify(value));
                }
            } else {
                result = result.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), String(value));
            }
        }
        
        if (apiKey) {
            result = result.replace(/\$\{API_KEY\}/g, apiKey);
        }
        
        return result;
    } else if (Array.isArray(obj)) {
        return obj.map(item => replacePlaceholdersInObject(item, params, apiKey));
    } else if (typeof obj === 'object' && obj !== null) {
        const result: any = {};
        for (const [key, value] of Object.entries(obj)) {
            result[key] = replacePlaceholdersInObject(value, params, apiKey);
        }
        return result;
    } else {
        return obj;
    }
}

function validatePriceBounds(asset: Asset, price: number, minPrice?: number, maxPrice?: number): void {
    if (minPrice !== undefined && price < minPrice) {
        throw new Error(`Price ${price} for ${asset.name} is below minimum bound ${minPrice}`);
    }
    if (maxPrice !== undefined && price > maxPrice) {
        throw new Error(`Price ${price} for ${asset.name} is above maximum bound ${maxPrice}`);
    }
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

export async function fetchBatchPrices(assets: Asset[], sourceConfig: SourceConfig): Promise<BatchPriceResult> {
    try {
        const apiKey = getApiKey(sourceConfig);
        const url = buildBatchUrl(sourceConfig, assets, apiKey);
        const requestOptions = buildBatchRequestOptions(sourceConfig, url, apiKey, assets);
        
        const response = await axios(requestOptions);
        return parseBatchResponse(response.data, sourceConfig, assets);
        
    } catch (error) {
        logError('GenericRestAdapter', error as Error);
        throw error;
    }
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
            if (param === 'api_key' && apiKey) {
                queryParams.append('api_key', apiKey);
            } else if (param === 'symbol') {
                const symbols = assets.map(asset => asset.name.split('-')[0]).join(',');
                queryParams.append('symbol', symbols);
            } else if (param.startsWith('currency=')) {
                queryParams.append('currency', param.split('=')[1]);
            } else if (param.startsWith('convert=')) {
                queryParams.append('convert', param.split('=')[1]);
            } else if (param.startsWith('base=')) {
                queryParams.append('base', param.split('=')[1]);
            } else if (param.startsWith('currencies=')) {
                queryParams.append('currencies', param.split('=')[1]);
            } else if (param.startsWith('unit=')) {
                queryParams.append('unit', param.split('=')[1]);
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
        
    // Handle metals-specific response structures
    } else if (parsePattern.includes('metals.{metal}') || parsePattern.includes('rates.USD{symbol}')) {
        assets.forEach(asset => {
            let priceUSD: number;
            let feedTimestamp: string;
            
            if (parsePattern.includes('metals.{metal}')) {
                // Metals.dev format
                const metalKey = asset.name.split('-')[0] === 'XAU' ? 'gold' : 'silver';
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
                console.warn(`Failed to parse price for ${asset.name}: ${error}`);
            }
        });
    }
    
    return result;
} 