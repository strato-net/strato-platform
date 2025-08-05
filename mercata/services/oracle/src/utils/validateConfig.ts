import dotenv from 'dotenv';
import * as feedsConfig from '../config/feeds.json';
import * as sourcesConfig from '../config/sources.json';
import cron from 'node-cron';
import { oauthClient } from './oauth';
import { logInfo, logError } from './logger';

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
            if (!feed.source) errors.push(`${feedPrefix} Missing source`);
            if (!feed.targetAssetAddress) errors.push(`${feedPrefix} Missing targetAssetAddress`);
            if (!feed.cron) errors.push(`${feedPrefix} Missing cron`);
            if (!feed.apiParams) errors.push(`${feedPrefix} Missing apiParams`);
            
            // Validate cron expression
            if (feed.cron && !cron.validate(feed.cron)) {
                errors.push(`${feedPrefix} Invalid cron expression: ${feed.cron}`);
            }
            
            // Check if source exists
            if (feed.source && !(sourcesConfig as any)[feed.source]) {
                errors.push(`${feedPrefix} Unknown source: ${feed.source}`);
            }
            
            // Collect used sources
            if (feed.source) {
                usedSources.add(feed.source);
            }
            
            // Validate price bounds
            if (feed.minPrice && feed.maxPrice && feed.minPrice >= feed.maxPrice) {
                errors.push(`${feedPrefix} minPrice must be less than maxPrice`);
            }
            
            if (errors.length === 0) {
                logInfo('ConfigValidator', `   ✅ ${feed.name}: Valid`);
            }
        });
    }

    // Validate sources configuration
    logInfo('ConfigValidator', '4. Checking Sources Configuration...');
    const sourceNames = Object.keys(sourcesConfig);
    logInfo('ConfigValidator', `   ✅ Found ${sourceNames.length} sources: ${sourceNames.join(', ')}`);
    
    sourceNames.forEach(sourceName => {
        const source = (sourcesConfig as any)[sourceName];
        const sourcePrefix = `   Source ${sourceName}:`;
        
        if (!source.urlTemplate) {
            errors.push(`${sourcePrefix} Missing urlTemplate`);
        }
        if (!source.parsePath) {
            errors.push(`${sourcePrefix} Missing parsePath`);
        }
    });

    // Validate API keys for sources that are actually used
    logInfo('ConfigValidator', '5. Checking API Keys for Used Sources...');
    
    usedSources.forEach(sourceName => {
        const source = (sourcesConfig as any)[sourceName];
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
        console.error('Validation error:', error);
        process.exit(1);
    });
} 