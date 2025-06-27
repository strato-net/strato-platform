import dotenv from 'dotenv';
import * as feedsConfig from '../config/feeds.json';
import * as sourcesConfig from '../config/sources.json';
import cron from 'node-cron';
import { oauthClient } from './oauth';

dotenv.config();

export function validateConfig(): boolean {
    console.log('=== Validating Oracle Configuration ===\n');
    
    let errors: string[] = [];
    let warnings: string[] = [];

    // Validate environment variables
    console.log('1. Checking Environment Variables...');
    const requiredEnvVars = [
        'STRATO_NODE_URL',
        'OAUTH_DISCOVERY_URL',
        'OAUTH_CLIENT_ID',
        'OAUTH_CLIENT_SECRET',
        'USERNAME',
        'PASSWORD',
        'PRICE_ORACLE_ADDRESS',
        'ALCHEMY_API_KEY'
    ];

    requiredEnvVars.forEach(varName => {
        if (!process.env[varName]) {
            errors.push(`Missing required environment variable: ${varName}`);
        } else {
            console.log(`   ✅ ${varName}: Set`);
        }
    });

    // Validate OAuth configuration
    console.log('\n2. Checking OAuth Configuration...');
    if (process.env.OAUTH_DISCOVERY_URL && process.env.OAUTH_CLIENT_ID && process.env.OAUTH_CLIENT_SECRET) {
        console.log('   ✅ OAuth credentials configured');
        
        // Test OAuth connection
        oauthClient.validateToken()
            .then(isValid => {
                if (isValid) {
                    console.log('   ✅ OAuth connection test successful');
                } else {
                    warnings.push('OAuth connection test failed - check credentials');
                }
            })
            .catch(error => {
                warnings.push(`OAuth connection test error: ${(error as Error).message}`);
            });
    } else {
        errors.push('Incomplete OAuth configuration');
    }

    // Validate feeds configuration
    console.log('\n3. Checking Feeds Configuration...');
    if (!feedsConfig.feeds || !Array.isArray(feedsConfig.feeds)) {
        errors.push('feeds.json must contain a "feeds" array');
    } else {
        console.log(`   ✅ Found ${feedsConfig.feeds.length} feeds`);
        
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
            
            // Validate price bounds
            if (feed.minPrice && feed.maxPrice && feed.minPrice >= feed.maxPrice) {
                errors.push(`${feedPrefix} minPrice must be less than maxPrice`);
            }
            
            if (errors.length === 0) {
                console.log(`   ✅ ${feed.name}: Valid`);
            }
        });
    }

    // Validate sources configuration
    console.log('\n4. Checking Sources Configuration...');
    const sourceNames = Object.keys(sourcesConfig);
    console.log(`   ✅ Found ${sourceNames.length} sources: ${sourceNames.join(', ')}`);
    
    sourceNames.forEach(sourceName => {
        const source = (sourcesConfig as any)[sourceName];
        const sourcePrefix = `   Source ${sourceName}:`;
        
        if (!source.urlTemplate) {
            errors.push(`${sourcePrefix} Missing urlTemplate`);
        }
        if (!source.parsePath) {
            errors.push(`${sourcePrefix} Missing parsePath`);
        }
        
        // Check if API key is required and available
        if (source.apiKeyEnvVar) {
            if (!process.env[source.apiKeyEnvVar]) {
                warnings.push(`${sourcePrefix} API key ${source.apiKeyEnvVar} not set`);
            } else {
                console.log(`   ✅ ${sourceName}: API key available`);
            }
        }
    });

    // Print results
    console.log('\n=== Validation Results ===');
    
    if (errors.length > 0) {
        console.log('\n❌ ERRORS:');
        errors.forEach(error => console.log(`   ${error}`));
    }
    
    if (warnings.length > 0) {
        console.log('\n⚠️  WARNINGS:');
        warnings.forEach(warning => console.log(`   ${warning}`));
    }
    
    if (errors.length === 0) {
        console.log('\n✅ Configuration is valid!');
        if (warnings.length === 0) {
            console.log('✅ No warnings found.');
        }
        return true;
    } else {
        console.log(`\n❌ Found ${errors.length} error(s) and ${warnings.length} warning(s)`);
        return false;
    }
}

if (require.main === module) {
    const isValid = validateConfig();
    process.exit(isValid ? 0 : 1);
} 