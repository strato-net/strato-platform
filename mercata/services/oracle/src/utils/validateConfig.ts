import dotenv from 'dotenv';
import cron from 'node-cron';
import { oauthClient } from './oauth';
import { logInfo, logError } from './logger';
import { SourceConfig } from '../types';

// Configurable minimum interval (in minutes)
const MIN_UPDATE_INTERVAL_MINUTES = parseInt(process.env.MIN_UPDATE_INTERVAL_MINUTES || '15');

const feedsConfig = require('../config/feeds.json');
const sourcesConfig = require('../config/sources.json');

dotenv.config();

export async function validateConfig(): Promise<boolean> {
    const errors: string[] = [];
    const warnings: string[] = [];

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
                warnings.push('OAuth connection test failed - check credentials');
            }
        } catch (error) {
            warnings.push(`OAuth connection test error: ${(error as Error).message}`);
        }
    } else {
        errors.push('Incomplete OAuth configuration');
    }

    const usedSources = new Set<string>();
    
    if (!feedsConfig.feeds || !Array.isArray(feedsConfig.feeds)) {
        errors.push('feeds.json must contain a "feeds" array');
    } else {
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
                // Check minutes field (first position) - allow */X but prevent too frequent updates
                if (cronParts.length >= 1 && cronParts[0].includes('/')) {
                    const divisor = parseInt(cronParts[0].split('/')[1]);
                    if (divisor < MIN_UPDATE_INTERVAL_MINUTES) {
                        errors.push(`${feedPrefix} Cron expression too frequent (less than ${MIN_UPDATE_INTERVAL_MINUTES} minutes): ${feed.cron}`);
                    }
                }
                // Prevent every minute (*) in minutes field
                if (cronParts.length >= 1 && cronParts[0] === '*') {
                    errors.push(`${feedPrefix} Cron expression too frequent (every minute): ${feed.cron}`);
                }
            }
            
            // Validate price bounds
            if (feed.minPrice && feed.maxPrice && feed.minPrice >= feed.maxPrice) {
                errors.push(`${feedPrefix} minPrice must be less than maxPrice`);
            }
            
        });
    }

    const sourceNames = Object.keys(sourcesConfig);
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

    usedSources.forEach(sourceName => {
        const source = typedSourcesConfig[sourceName];
        if (source && source.apiKeyEnvVar && !process.env[source.apiKeyEnvVar]) {
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