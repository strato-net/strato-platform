import dotenv from 'dotenv';
import { oauthClient } from './oauth';
import { logInfo, logError } from './logger';

const feedsConfig = require('../config/feeds.json');
const sourcesConfig = require('../config/sources.json');
const assetsConfig = require('../config/assets.json');

dotenv.config();

export async function validateConfig(): Promise<boolean> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const usedSources = new Set<string>();

    const requiredEnvVars = [
        'STRATO_NODE_URL', 'OAUTH_DISCOVERY_URL', 'OAUTH_CLIENT_ID',
        'OAUTH_CLIENT_SECRET', 'USERNAME', 'PASSWORD', 'PRICE_ORACLE_ADDRESS'
    ];

    requiredEnvVars.forEach(varName => {
        if (!process.env[varName]) {
            errors.push(`Missing required environment variable: ${varName}`);
        }
    });

    if (process.env.OAUTH_DISCOVERY_URL && process.env.OAUTH_CLIENT_ID && process.env.OAUTH_CLIENT_SECRET) {
        try {
            const isValid = await oauthClient().validateToken();
            if (!isValid) {
                errors.push('OAuth authentication failed - check credentials');
            }
        } catch (error) {
            errors.push(`OAuth authentication error: ${(error as Error).message}`);
        }
    } else {
        errors.push('Incomplete OAuth configuration');
    }
    
    if (!feedsConfig.feeds || !Array.isArray(feedsConfig.feeds)) {
        errors.push('feeds.json must contain a "feeds" array');
    } else {
        feedsConfig.feeds.forEach((feed: any, index: number) => {
            const feedPrefix = `   Feed ${index + 1} (${feed.name}):`;
            
            // Check required fields
            if (!feed.name) errors.push(`${feedPrefix} Missing name`);
            
            // Check if this is a batch feed
            const isBatchFeed = feed.assets && Array.isArray(feed.assets);
            
            if (isBatchFeed) {
                // Validate batch feed structure
                if (!feed.sources || !Array.isArray(feed.sources)) {
                    errors.push(`${feedPrefix} Missing or invalid sources array`);
                }
                
                // Validate sources array for batch feeds
                if (feed.sources && Array.isArray(feed.sources)) {
                    feed.sources.forEach((sourceName: string, sourceIndex: number) => {
                        const sourcePrefix = `${feedPrefix} Source ${sourceIndex + 1}:`;
                        
                        if (!sourceName) {
                            errors.push(`${sourcePrefix} Missing source name`);
                        } else if (!(sourcesConfig as any)[sourceName]) {
                            errors.push(`${sourcePrefix} Unknown source: ${sourceName}`);
                        } else {
                            usedSources.add(sourceName);
                        }
                    });
                }
                
                // Validate assets array (now just asset keys)
                if (!feed.assets || !Array.isArray(feed.assets) || feed.assets.length === 0) {
                    errors.push(`${feedPrefix} Missing or invalid assets array`);
                } else {
                    // Load assets registry to validate asset keys
                    feed.assets.forEach((assetKey: string, assetIndex: number) => {
                        const assetPrefix = `${feedPrefix} Asset ${assetIndex + 1}:`;
                        
                        if (!assetKey) {
                            errors.push(`${assetPrefix} Missing asset key`);
                        } else if (!assetsConfig.assets[assetKey]) {
                            errors.push(`${assetPrefix} Unknown asset key: ${assetKey}`);
                        } else {
                            const asset = assetsConfig.assets[assetKey];
                            
                            // Validate targetAssetAddress format
                            if (asset.targetAssetAddress && !/^[a-fA-F0-9]{40}$/.test(asset.targetAssetAddress)) {
                                errors.push(`${assetPrefix} Invalid targetAssetAddress format: ${asset.targetAssetAddress}`);
                            }
                            
                            // Validate tokenAddress format for crypto assets
                            if (asset.tokenAddress && !/^0x[a-fA-F0-9]{40}$/.test(asset.tokenAddress)) {
                                errors.push(`${assetPrefix} Invalid tokenAddress format: ${asset.tokenAddress}`);
                            }
                        }
                    });
                }
            } else {
                // Validate individual feed structure (legacy)
                if (!feed.sources || !Array.isArray(feed.sources)) {
                    errors.push(`${feedPrefix} Missing or invalid sources array`);
                }
                if (!feed.targetAssetAddress) errors.push(`${feedPrefix} Missing targetAssetAddress`);
                
                // Validate sources array
                if (feed.sources && Array.isArray(feed.sources)) {
                    feed.sources.forEach((source: any, sourceIndex: number) => {
                        const sourcePrefix = `${feedPrefix} Source ${sourceIndex + 1}:`;
                        
                        if (!source.name) {
                            errors.push(`${sourcePrefix} Missing source name`);
                        } else if (!(sourcesConfig as any)[source.name]) {
                            errors.push(`${sourcePrefix} Unknown source: ${source.name}`);
                        } else {
                            usedSources.add(source.name);
                        }
                    });
                }
                
                // Validate feed structure consistency
                if (!feed.tokenAddress && !feed.symbol) {
                    errors.push(`${feedPrefix} Must have either tokenAddress (for crypto) or symbol (for metals)`);
                }
                
                // Validate tokenAddress format (if present)
                if (feed.tokenAddress && !/^0x[a-fA-F0-9]{40}$/.test(feed.tokenAddress)) {
                    errors.push(`${feedPrefix} Invalid tokenAddress format: ${feed.tokenAddress}`);
                }
                
                // Validate targetAssetAddress format
                if (feed.targetAssetAddress && !/^[a-fA-F0-9]{40}$/.test(feed.targetAssetAddress)) {
                    errors.push(`${feedPrefix} Invalid targetAssetAddress format: ${feed.targetAssetAddress}`);
                }
            }
            
            // Validate price bounds
            if (feed.minPrice && feed.maxPrice && feed.minPrice >= feed.maxPrice) {
                errors.push(`${feedPrefix} minPrice must be less than maxPrice`);
            }
            
        });
    }

    // Validate sources
    const sourceNames = Object.keys(sourcesConfig);
    sourceNames.forEach(sourceName => {
        const source = sourcesConfig[sourceName];
        const sourcePrefix = `   Source ${sourceName}:`;
        
        if (!source.url) {
            errors.push(`${sourcePrefix} Missing url`);
        }

        if (!source.parse) {
            errors.push(`${sourcePrefix} Missing parse pattern`);
        }

        // Check if API key environment variable exists
        if (source.apiKeyEnvVar && !process.env[source.apiKeyEnvVar]) {
            errors.push(`Missing required API key for source ${sourceName}: ${source.apiKeyEnvVar}`);
        }
    });

    if (errors.length > 0) {
        logError('ConfigValidator', new Error(`Configuration errors:\n${errors.map(error => `   ${error}`).join('\n')}`));
        return false;
    }
    
    if (warnings.length > 0) {
        logInfo('ConfigValidator', `Warnings:\n${warnings.map(warning => `   ${warning}`).join('\n')}`);
    }
    
    return true;
}

if (require.main === module) {
    validateConfig().then(isValid => {
        process.exit(isValid ? 0 : 1);
    }).catch(error => {
        logError('ConfigValidator', new Error(`Validation error: ${error}`));
        process.exit(1);
    });
} 