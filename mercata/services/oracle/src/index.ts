import dotenv from 'dotenv';
import { startCronScheduler } from './cronScheduler';
import { logInfo, logError } from './utils/logger';
import { oauthClient } from './utils/oauth';
import express from 'express';
import * as packageJson from '../package.json';

dotenv.config();

async function main(): Promise<void> {
    try {
        // Validate required environment variables
        const requiredEnvVars: string[] = [
            'STRATO_NODE_URL',
            'OAUTH_DISCOVERY_URL',
            'OAUTH_CLIENT_ID',
            'OAUTH_CLIENT_SECRET',
            'USERNAME',
            'PASSWORD',
            'PRICE_ORACLE_ADDRESS',
            'ALCHEMY_API_KEY'
        ];

        const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
        if (missingVars.length > 0) {
            throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
        }

        logInfo('Main', 'Starting Price Oracle Service...');
        logInfo('Main', `STRATO Node: ${process.env.STRATO_NODE_URL}`);
        logInfo('Main', `Oracle Address: ${process.env.PRICE_ORACLE_ADDRESS}`);
        
        // Test OAuth connection
        try {
            logInfo('Main', 'Testing OAuth connection...');
            const isValid = await oauthClient.validateToken();
            if (!isValid) {
                throw new Error('OAuth authentication failed');
            }
            logInfo('Main', 'OAuth connection successful');
        } catch (error) {
            logError('Main', new Error(`OAuth test failed: ${(error as Error).message}`));
            process.exit(1);
        }
        
        // Start the cron scheduler
        startCronScheduler();
        
        logInfo('Main', 'Price Oracle Service started successfully');
        
    } catch (error) {
        logError('Main', error as Error);
        process.exit(1);
    }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error: Error) => {
    logError('UncaughtException', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
    logError('UnhandledRejection', new Error(`Unhandled Rejection at: ${promise}, reason: ${reason}`));
    process.exit(1);
});

// Start health check server
const app = express();
const PORT = process.env.HEALTH_PORT || 3000;
app.get('/health', (req, res) => res.status(200).json({ status: 'OK', version: packageJson.version }));
app.listen(PORT, () => {
    logInfo('HealthCheck', `/health endpoint listening on port ${PORT}`);
});

// Start the service
main(); 