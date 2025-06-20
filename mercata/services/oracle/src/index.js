require('dotenv').config();
const { startCronScheduler } = require('./cronScheduler');
const { logInfo, logError } = require('./utils/logger');
const { oauthClient } = require('./utils/oauth');
const express = require('express');
const packageJson = require('../package.json');

async function main() {
    try {
        // Validate required environment variables
        const requiredEnvVars = [
            'STRATO_NODE_URL',
            'OAUTH_DISCOVERY_URL',
            'CLIENT_ID',
            'CLIENT_SECRET',
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
            logError('Main', new Error(`OAuth test failed: ${error.message}`));
            process.exit(1);
        }
        
        // Start the cron scheduler
        startCronScheduler();
        
        logInfo('Main', 'Price Oracle Service started successfully');
        
    } catch (error) {
        logError('Main', error);
        process.exit(1);
    }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    logError('UncaughtException', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
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