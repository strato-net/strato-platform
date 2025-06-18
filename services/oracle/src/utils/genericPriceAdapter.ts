import axios from 'axios';
import logger from './logger';

export interface FeedConfig {
  name: string;
  source: string;
  targetAssetAddress: string;
  cron: string;
  apiParams: Record<string, any>;
  minPrice: number;
  maxPrice: number;
}

export interface SourceConfig {
  name: string;
  apiKeyEnvVar?: string;
  urlTemplate: string;
  parsePath: string;
  feedTimestampPath?: string;
  headers?: Record<string, string>;
}

export async function fetchGenericPrice(feedConfig: FeedConfig, sourceConfig: SourceConfig): Promise<{
  price: number;
  feedTimestamp: string;
}> {
  try {
    const apiKey = sourceConfig.apiKeyEnvVar ? process.env[sourceConfig.apiKeyEnvVar] : '';
    let url = sourceConfig.urlTemplate;

    // Replace placeholders in URL template
    for (const paramKey in feedConfig.apiParams) {
      url = url.replace(`\${${paramKey}}`, String(feedConfig.apiParams[paramKey]));
    }
    if (apiKey) {
      url = url.replace('${API_KEY}', apiKey);
    }

    // Prepare headers
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      ...sourceConfig.headers,
    };

    // Add authorization header if API key exists
    if (apiKey && sourceConfig.apiKeyEnvVar) {
      if (sourceConfig.name === 'Alchemy') {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }
    }

    logger.info(`[GenericAdapter] Fetching ${feedConfig.name} from ${url}`);

    const response = await axios.get(url, { headers });

    const priceUSD = extractNestedProperty(response.data, sourceConfig.parsePath);
    const feedTimestamp = sourceConfig.feedTimestampPath 
      ? extractNestedProperty(response.data, sourceConfig.feedTimestampPath) || new Date().toISOString()
      : new Date().toISOString();

    if (!priceUSD || isNaN(parseFloat(priceUSD))) {
      throw new Error(`Invalid price data received for ${feedConfig.name}: ${priceUSD}`);
    }

    const price = Math.floor(parseFloat(priceUSD) * 1e8); // Convert to 8-decimal format

    // Validate price bounds
    if (price < feedConfig.minPrice || price > feedConfig.maxPrice) {
      throw new Error(`Price ${price} for ${feedConfig.name} is outside bounds [${feedConfig.minPrice}, ${feedConfig.maxPrice}]`);
    }

    logger.info(`[GenericAdapter] ${feedConfig.name} → $${priceUSD} @ ${feedTimestamp}`);

    return {
      price,
      feedTimestamp
    };

  } catch (error) {
    logger.error(`[GenericAdapter] Error fetching ${feedConfig.name}:`, error);
    throw error;
  }
}

export function extractNestedProperty(obj: any, path: string): any {
  if (!path) return undefined;
  return path.split('.').reduce((o, key) => o?.[key], obj);
} 