import dotenv from 'dotenv';
import { oauthClient } from './oauth';
import { logInfo, logError } from './logger';
import { ORACLE_CONFIG } from './constants';

const sourcesConfig = require('../config/sources.json');
const assetsConfig = require('../config/assets.json');

dotenv.config();

/**
 * Get sources that support a given symbol (either in assets array or symbolMapping)
 */
function getSourcesForSymbol(symbol: string): string[] {
    return Object.entries(sourcesConfig)
        .filter(([_, config]: [string, any]) => {
            return config.assets?.includes(symbol) || config.symbolMapping?.[symbol];
        })
        .map(([name]) => name);
}

export async function validateConfig(): Promise<boolean> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate required environment variables
    const requiredEnvVars = [
        'STRATO_NODE_URL', 'OAUTH_DISCOVERY_URL', 'OAUTH_CLIENT_ID',
        'OAUTH_CLIENT_SECRET', 'USERNAME', 'PASSWORD', 'PRICE_ORACLE_ADDRESS'
    ];

    requiredEnvVars.forEach(varName => {
        if (!process.env[varName]) {
            errors.push(`Missing required environment variable: ${varName}`);
        }
    });

    // Validate OAuth configuration
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
    
    // Validate assets.json structure
    if (!assetsConfig.assets || typeof assetsConfig.assets !== 'object') {
        errors.push('assets.json must contain an "assets" object');
    } else {
        const assetKeys = Object.keys(assetsConfig.assets);
        
        assetKeys.forEach(assetKey => {
            const asset = assetsConfig.assets[assetKey];
            const assetPrefix = `   Asset ${assetKey}:`;
            
            // Validate required fields
            if (!asset.targetAssetAddress) {
                errors.push(`${assetPrefix} Missing targetAssetAddress`);
            } else if (!/^[a-fA-F0-9]{40}$/.test(asset.targetAssetAddress)) {
                errors.push(`${assetPrefix} Invalid targetAssetAddress format: ${asset.targetAssetAddress}`);
            }
            
            // Validate constantPrice is a number (if present)
            if (asset.constantPrice !== undefined && typeof asset.constantPrice !== 'number') {
                errors.push(`${assetPrefix} constantPrice must be a number`);
            }
            
            // Validate weekendProxy is a string (if present)
            if (asset.weekendProxy !== undefined && typeof asset.weekendProxy !== 'string') {
                errors.push(`${assetPrefix} weekendProxy must be a string (proxy symbol)`);
            }
            
            // Validate weekendProxy symbol has enough sources
            if (asset.weekendProxy) {
                const proxySources = getSourcesForSymbol(asset.weekendProxy);
                if (proxySources.length < ORACLE_CONFIG.MIN_VALID_SOURCES) {
                    errors.push(
                        `${assetPrefix} weekendProxy '${asset.weekendProxy}' has only ${proxySources.length} source(s), ` +
                        `needs at least ${ORACLE_CONFIG.MIN_VALID_SOURCES}. Sources: [${proxySources.join(', ')}]`
                    );
                }
            }
            
            // Validate submit field if present
            if (asset.submit !== undefined && typeof asset.submit !== 'boolean') {
                errors.push(`${assetPrefix} submit must be a boolean`);
            }
        });
    }

    // Validate sources.json structure and build asset-to-sources mapping
    const assetSourceCount: Record<string, string[]> = {};
    const sourceNames = Object.keys(sourcesConfig);
    
    sourceNames.forEach(sourceName => {
        const source = sourcesConfig[sourceName];
        const sourcePrefix = `   Source ${sourceName}:`;
        
        // Each source must have an assets array
        if (!source.assets || !Array.isArray(source.assets)) {
            errors.push(`${sourcePrefix} Missing or invalid 'assets' array`);
            return;
        }
        
        // Skip URL validation for constant and RPC-based sources
        if (sourceName !== 'constant' && sourceName !== 'ChainlinkPriceFeedRPC' && !source.url) {
            errors.push(`${sourcePrefix} Missing url`);
        }

        // Validate parse pattern
        if (!source.parse) {
            errors.push(`${sourcePrefix} Missing parse pattern`);
        }

        // Check if API key environment variable exists
        if (source.apiKeyEnvVar && !process.env[source.apiKeyEnvVar]) {
            errors.push(`Missing required API key for source ${sourceName}: ${source.apiKeyEnvVar}`);
        }
        
        // Validate each asset in the source's assets array
        source.assets.forEach((assetKey: string) => {
            // Check asset exists in assets.json
            if (!assetsConfig.assets[assetKey]) {
                errors.push(`${sourcePrefix} References unknown asset: ${assetKey}`);
                return;
            }
            
            // Track which sources support each asset
            if (!assetSourceCount[assetKey]) {
                assetSourceCount[assetKey] = [];
            }
            assetSourceCount[assetKey].push(sourceName);
            
            // Check symbolMapping exists for assets that need it
            if (source.symbolMapping && !source.symbolMapping[assetKey]) {
                warnings.push(`${sourcePrefix} No symbolMapping for asset ${assetKey} (may use default)`);
            }
        });
        
        // Validate constant source has assets with constantPrice
        if (sourceName === 'constant') {
            source.assets.forEach((assetKey: string) => {
                const asset = assetsConfig.assets[assetKey];
                if (asset && (asset.constantPrice === undefined || typeof asset.constantPrice !== 'number')) {
                    errors.push(`${sourcePrefix} Asset ${assetKey} must have a numeric constantPrice field`);
                }
            });
        }
    });
    
    // Validate each asset has at least MIN_VALID_SOURCES
    const assetKeys = Object.keys(assetsConfig.assets);
    assetKeys.forEach(assetKey => {
        const asset = assetsConfig.assets[assetKey];
        const sources = assetSourceCount[assetKey] || [];
        
        // Skip validation for assets not submitted (e.g., proxy-only assets like KAG)
        if (asset.submit === false) {
            return;
        }
        
        // Skip minimum source check for constant-priced assets
        if (asset.constantPrice !== undefined) {
            if (!sources.includes('constant')) {
                warnings.push(`Asset ${assetKey} has constantPrice but no 'constant' source references it`);
            }
            return;
        }
        
        // Skip minimum source check for assets with weekendProxy (they use proxy sources when needed)
        if (asset.weekendProxy !== undefined) {
            if (sources.length === 0) {
                warnings.push(`Asset ${assetKey} has no direct sources, relies on weekendProxy '${asset.weekendProxy}'`);
            }
            return;
        }
        
        if (sources.length < ORACLE_CONFIG.MIN_VALID_SOURCES) {
            errors.push(
                `Asset ${assetKey} has only ${sources.length} source(s), needs at least ${ORACLE_CONFIG.MIN_VALID_SOURCES}. ` +
                `Sources: [${sources.join(', ')}]`
            );
        }
    });
    
    // Log validation results
    if (errors.length > 0) {
        logError('ConfigValidator', new Error(`Configuration errors:\n${errors.map(error => `   ${error}`).join('\n')}`));
        return false;
    }
    
    if (warnings.length > 0) {
        logInfo('ConfigValidator', `Warnings:\n${warnings.map(warning => `   ${warning}`).join('\n')}`);
    }
    
    // Count assets that won't be submitted
    const proxyOnlyAssets = assetKeys.filter(k => assetsConfig.assets[k].submit === false);
    const submitCount = assetKeys.length - proxyOnlyAssets.length;
    
    let summary = `Configuration valid. ${submitCount}/${assetKeys.length} assets to submit, ${sourceNames.length} sources.`;
    if (proxyOnlyAssets.length > 0) {
        summary += ` Proxy-only: [${proxyOnlyAssets.join(', ')}]`;
    }
    logInfo('ConfigValidator', summary);
    
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
