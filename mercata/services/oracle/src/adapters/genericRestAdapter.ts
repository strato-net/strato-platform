import axios from 'axios';
import { logInfo, logError } from '../utils/logger';

export interface FeedConfig {
    name: string;
    source: string;
    targetAssetAddress: string;
    cron: string;
    apiParams: Record<string, any>;
    minPrice?: number;
    maxPrice?: number;
}

export interface SourceConfig {
    name?: string;
    apiKeyEnvVar?: string;
    urlTemplate: string;
    parsePath: string;
    feedTimestampPath?: string;
    headers?: Record<string, string>;
    method?: string;
    requestBody?: any;
}

export async function fetchGenericPrice(feedConfig: FeedConfig, sourceConfig: SourceConfig): Promise<{
    price: number;
    feedTimestamp: string;
}> {
    try {
        const apiKey = sourceConfig.apiKeyEnvVar ? process.env[sourceConfig.apiKeyEnvVar] : '';
        let url = sourceConfig.urlTemplate;

        // Replace placeholders in URL
        for (const paramKey in feedConfig.apiParams) {
            url = url.replace(`\${${paramKey}}`, String(feedConfig.apiParams[paramKey]));
        }
        if (apiKey) {
            url = url.replace('${API_KEY}', apiKey);
        }

        // Prepare request options
        const requestOptions: any = {
            method: sourceConfig.method || 'GET',
            url: url,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                ...sourceConfig.headers,
            }
        };

        // Add authorization header if API key exists
        if (apiKey && sourceConfig.apiKeyEnvVar) {
            if (sourceConfig.name === 'Alchemy') {
                requestOptions.headers['Authorization'] = `Bearer ${apiKey}`;
            }
        }

        // Handle POST request body if present
        if (sourceConfig.requestBody) {
            let requestBody = JSON.parse(JSON.stringify(sourceConfig.requestBody)); // Deep clone
            
            // Replace placeholders in request body
            const bodyStr = JSON.stringify(requestBody);
            let processedBodyStr = bodyStr;
            
            for (const paramKey in feedConfig.apiParams) {
                processedBodyStr = processedBodyStr.replace(new RegExp(`\\$\\{${paramKey}\\}`, 'g'), String(feedConfig.apiParams[paramKey]));
            }
            processedBodyStr = processedBodyStr.replace(/\$\{API_KEY\}/g, apiKey || '');
            
            requestOptions.data = JSON.parse(processedBodyStr);
        }

        logInfo('GenericAdapter', `Fetching ${feedConfig.name} from ${url.replace(apiKey || 'NO_API_KEY', '***')} (${requestOptions.method})`);

        const response = await axios(requestOptions);

        // Handle dynamic parse path replacement (e.g., metals.${metal})
        let parsePath = sourceConfig.parsePath;
        for (const paramKey in feedConfig.apiParams) {
            parsePath = parsePath.replace(`\${${paramKey}}`, String(feedConfig.apiParams[paramKey]));
        }

        // Debug logging for metals API
        if (feedConfig.source === 'Metals.dev') {
            logInfo('GenericAdapter', `[DEBUG] ${feedConfig.name} - Original parsePath: ${sourceConfig.parsePath}`);
            logInfo('GenericAdapter', `[DEBUG] ${feedConfig.name} - Final parsePath: ${parsePath}`);
            logInfo('GenericAdapter', `[DEBUG] ${feedConfig.name} - metals.gold: ${response.data.metals?.gold}`);
            logInfo('GenericAdapter', `[DEBUG] ${feedConfig.name} - metals.silver: ${response.data.metals?.silver}`);
        }

        const priceUSD = extractNestedProperty(response.data, parsePath);
        const feedTimestamp = sourceConfig.feedTimestampPath 
            ? extractNestedProperty(response.data, sourceConfig.feedTimestampPath) || new Date().toISOString()
            : new Date().toISOString();

        if (!priceUSD || isNaN(parseFloat(priceUSD))) {
            throw new Error(`Invalid price data received for ${feedConfig.name}: ${priceUSD}`);
        }

        const price = Math.floor(parseFloat(priceUSD) * 1e18); // Convert to 18-decimal format

        // Validate price bounds if specified
        if (feedConfig.minPrice !== undefined && price < feedConfig.minPrice) {
            throw new Error(`Price ${price} for ${feedConfig.name} is below minimum bound ${feedConfig.minPrice}`);
        }
        if (feedConfig.maxPrice !== undefined && price > feedConfig.maxPrice) {
            throw new Error(`Price ${price} for ${feedConfig.name} is above maximum bound ${feedConfig.maxPrice}`);
        }

        logInfo('GenericAdapter', `${feedConfig.name} → $${priceUSD} @ feedTimestamp: ${feedTimestamp}`);

        return {
            price,
            feedTimestamp
        };

    } catch (error) {
        logError('GenericAdapter', error as Error);
        throw error;
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