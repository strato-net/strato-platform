import dotenv from 'dotenv';
import * as feedsConfig from '../config/feeds.json';
import * as sourcesConfig from '../config/sources.json';
import cron from 'node-cron';
import { oauthClient } from './oauth';
import { logInfo, logError } from './logger';
import { SourceConfig } from '../types';

dotenv.config();

export async function validateConfig(): Promise<boolean> {
    logInfo('ConfigValidator', '=== Validating Oracle Configuration ===');
    
    let errors: string[] = [];
    let warnings: string[] = [];

    // Validate environment variables
    logInfo('ConfigValidator', '1. Checking Environment Variables...');
    const baseRequiredEnvVars = [
        'STRATO_NODE_URL',
        'OAUTH_DISCOVERY_URL',
        'OAUTH_CLIENT_ID',
        'OAUTH_CLIENT_SECRET',
        'USERNAME',
        'PASSWORD',
        'PRICE_ORACLE_ADDRESS'
    ];

    baseRequiredEnvVars.forEach(varName => {
        if (!process.env[varName]) {
            errors.push(`Missing required environment variable: ${varName}`);
        } else {
            logInfo('ConfigValidator', `   ✅ ${varName}: Set`);
        }
    });

    // Validate OAuth configuration
    logInfo('ConfigValidator', '2. Checking OAuth Configuration...');
    if (process.env.OAUTH_DISCOVERY_URL && process.env.OAUTH_CLIENT_ID && process.env.OAUTH_CLIENT_SECRET) {
        logInfo('ConfigValidator', '   ✅ OAuth credentials configured');
        
        // Test OAuth connection
        try {
            const isValid = await oauthClient.validateToken();
            if (isValid) {
                logInfo('ConfigValidator', '   ✅ OAuth connection test successful');
            } else {
                warnings.push('OAuth connection test failed - check credentials');
            }
        } catch (error) {
            warnings.push(`OAuth connection test error: ${(error as Error).message}`);
        }
    } else {
        errors.push('Incomplete OAuth configuration');
    }

    // Validate feeds configuration
    logInfo('ConfigValidator', '3. Checking Feeds Configuration...');
    const usedSources = new Set<string>();
    
    if (!feedsConfig.feeds || !Array.isArray(feedsConfig.feeds)) {
        errors.push('feeds.json must contain a "feeds" array');
    } else {
        logInfo('ConfigValidator', `   ✅ Found ${feedsConfig.feeds.length} feeds`);
        
        feedsConfig.feeds.forEach((feed: any, index: number) => {
            const feedPrefix = `   Feed ${index + 1} (${feed.name}):`;
            
            // Check required fields
            if (!feed.name) errors.push(`${feedPrefix} Missing name`);
            if (!feed.sources || !Array.isArray(feed.sources)) {
                errors.push(`${feedPrefix} Missing or invalid sources array`);
            }
            if (!feed.targetAssetAddress) errors.push(`${feedPrefix} Missing targetAssetAddress`);
            if (!feed.cron) errors.push(`${feedPrefix} Missing cron`);
            
            // Validate cron expression
            if (feed.cron && !cron.validate(feed.cron)) {
                errors.push(`${feedPrefix} Invalid cron expression: ${feed.cron}`);
            }
            
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
            if (feed.tokenAddress && feed.symbol) {
                errors.push(`${feedPrefix} Cannot have both tokenAddress and symbol`);
            }
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
            
            // Validate cron frequency (prevent too frequent updates)
            if (feed.cron) {
                const cronParts = feed.cron.split(' ');
                if (cronParts.length >= 2 && cronParts[1] === '*') {
                    errors.push(`${feedPrefix} Cron expression too frequent (every minute): ${feed.cron}`);
                }
            }
            
            // Validate price bounds
            if (feed.minPrice && feed.maxPrice && feed.minPrice >= feed.maxPrice) {
                errors.push(`${feedPrefix} minPrice must be less than maxPrice`);
            }
            
            // Log validation result for this feed
            const feedErrors = errors.filter(error => error.includes(feedPrefix));
            if (feedErrors.length === 0) {
                logInfo('ConfigValidator', `   ✅ ${feed.name}: Valid (${feed.sources?.length || 0} sources)`);
            } else {
                logInfo('ConfigValidator', `   ❌ ${feed.name}: ${feedErrors.length} error(s)`);
            }
        });
    }

    // Validate sources configuration
    logInfo('ConfigValidator', '4. Checking Sources Configuration...');
    const sourceNames = Object.keys(sourcesConfig);
    logInfo('ConfigValidator', `   ✅ Found ${sourceNames.length} sources: ${sourceNames.join(', ')}`);
    
    const typedSourcesConfig = sourcesConfig as Record<string, SourceConfig>;
    sourceNames.forEach(sourceName => {
        const source = typedSourcesConfig[sourceName];
        const sourcePrefix = `   Source ${sourceName}:`;
        
        if (!source.urlTemplate) {
            errors.push(`${sourcePrefix} Missing urlTemplate`);
        } else {
            // Validate URL template has required placeholders
            if (source.apiKeyEnvVar && !source.urlTemplate.includes('${API_KEY}') && source.apiKeyType !== 'header') {
                errors.push(`${sourcePrefix} urlTemplate missing API_KEY placeholder`);
            }
        }
        
        if (!source.parsePath) {
            errors.push(`${sourcePrefix} Missing parsePath`);
        } else {
            // Validate parse path format
            if (!source.parsePath.includes('.') && !source.parsePath.includes('[')) {
                errors.push(`${sourcePrefix} parsePath should use dot notation or array indexing`);
            }
        }
        
        // Validate API key configuration
        if (source.apiKeyEnvVar && !source.apiKeyType) {
            errors.push(`${sourcePrefix} apiKeyEnvVar specified but apiKeyType missing`);
        }
    });

    // Validate API keys for sources that are actually used
    logInfo('ConfigValidator', '5. Checking API Keys for Used Sources...');
    
    usedSources.forEach(sourceName => {
        const source = typedSourcesConfig[sourceName];
        if (source && source.apiKeyEnvVar) {
            if (!process.env[source.apiKeyEnvVar]) {
                errors.push(`Missing required API key for source ${sourceName}: ${source.apiKeyEnvVar}`);
            } else {
                logInfo('ConfigValidator', `   ✅ ${sourceName}: API key available`);
            }
        } else if (source) {
            logInfo('ConfigValidator', `   ✅ ${sourceName}: No API key required`);
        }
    });

    // Print results
    logInfo('ConfigValidator', '=== Validation Results ===');
    
    if (errors.length > 0) {
        logError('ConfigValidator', new Error(`\n❌ ERRORS:\n${errors.map(error => `   ${error}`).join('\n')}`));
    }
    
    if (warnings.length > 0) {
        logInfo('ConfigValidator', `\n⚠️  WARNINGS:\n${warnings.map(warning => `   ${warning}`).join('\n')}`);
    }
    
    if (errors.length === 0) {
        logInfo('ConfigValidator', '\n✅ Configuration is valid!');
        if (warnings.length === 0) {
            logInfo('ConfigValidator', '✅ No warnings found.');
        }
        return true;
    } else {
        logError('ConfigValidator', new Error(`\n❌ Found ${errors.length} error(s) and ${warnings.length} warning(s)`));
        return false;
    }
}

if (require.main === module) {
    validateConfig().then(isValid => {
        process.exit(isValid ? 0 : 1);
    }).catch(error => {
        logError('ConfigValidator', new Error(`Validation error: ${error}`));
        process.exit(1);
    });
} 