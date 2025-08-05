import axios from 'axios';
import { logError } from '../utils/logger';
import { FeedConfig, SourceConfig } from '../types';

export async function fetchGenericPrice(feedConfig: FeedConfig, sourceConfig: SourceConfig): Promise<{
    price: number;
    feedTimestamp: string;
}> {
    try {
        const apiKey = sourceConfig.apiKeyEnvVar ? process.env[sourceConfig.apiKeyEnvVar] : '';
        
        const url = replacePlaceholders(sourceConfig.urlTemplate, feedConfig.apiParams, apiKey || '');
        const requestOptions = buildRequestOptions(sourceConfig, url, apiKey, feedConfig.apiParams);
        
        const response = await axios(requestOptions);
        
        const parsePath = replacePlaceholders(sourceConfig.parsePath, feedConfig.apiParams);
        const priceUSD = extractNestedProperty(response.data, parsePath);
        const feedTimestamp = sourceConfig.feedTimestampPath 
            ? extractNestedProperty(response.data, replacePlaceholders(sourceConfig.feedTimestampPath!, feedConfig.apiParams)) || new Date().toISOString()
            : new Date().toISOString();

        if (!priceUSD || isNaN(parseFloat(priceUSD))) {
            throw new Error(`Invalid price data received for ${feedConfig.name}: ${priceUSD}`);
        }

        const price = Math.floor(parseFloat(priceUSD) * 1e18);

        validatePriceBounds(feedConfig, price);

        return { price, feedTimestamp };

    } catch (error) {
        logError('GenericAdapter', error as Error);
        throw error;
    }
}

function replacePlaceholders(template: string, params: Record<string, any>, apiKey: string = ''): string {
    let result = template;
    
    // Replace API parameters
    for (const [key, value] of Object.entries(params)) {
        result = result.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), String(value));
    }
    
    // Replace API key
    if (apiKey) {
        result = result.replace(/\$\{API_KEY\}/g, apiKey);
    }
    
    return result;
}

function buildRequestOptions(sourceConfig: SourceConfig, url: string, apiKey: string = '', apiParams: Record<string, any> = {}): any {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...sourceConfig.headers,
    };

    // Add authorization header based on configuration
    if (apiKey && sourceConfig.apiKeyType === 'bearer') {
        headers['Authorization'] = `Bearer ${apiKey}`;
    }

    // Replace API key placeholders in headers
    if (apiKey && sourceConfig.apiKeyType === 'header') {
        for (const [key, value] of Object.entries(headers)) {
            headers[key] = value.replace(/\$\{API_KEY\}/g, apiKey);
        }
    }

    const requestOptions: any = {
        method: sourceConfig.method || 'GET',
        url,
        headers,
    };

    // Handle POST request body
    if (sourceConfig.requestBody) {
        const requestBodyStr = JSON.stringify(sourceConfig.requestBody);
        const processedBodyStr = replacePlaceholders(requestBodyStr, apiParams, apiKey);
        requestOptions.data = JSON.parse(processedBodyStr);
    }

    return requestOptions;
}

function validatePriceBounds(feedConfig: FeedConfig, price: number): void {
    if (feedConfig.minPrice !== undefined && price < feedConfig.minPrice) {
        throw new Error(`Price ${price} for ${feedConfig.name} is below minimum bound ${feedConfig.minPrice}`);
    }
    if (feedConfig.maxPrice !== undefined && price > feedConfig.maxPrice) {
        throw new Error(`Price ${price} for ${feedConfig.name} is above maximum bound ${feedConfig.maxPrice}`);
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