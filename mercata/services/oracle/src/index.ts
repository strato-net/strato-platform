import dotenv from 'dotenv';
import { startCronScheduler } from './cronScheduler';
import { logInfo, logError } from './utils/logger';
import { validateConfig } from './utils/validateConfig';
import { healthMonitor } from './utils/healthMonitor';
import express from 'express';
import * as packageJson from '../package.json';

dotenv.config();

async function main(): Promise<void> {
    try {
        // Validate configuration
        if (!(await validateConfig())) {
            throw new Error('Configuration validation failed');
        }

        logInfo('Main', 'Starting Price Oracle Service...');
        logInfo('Main', `STRATO Node: ${process.env.STRATO_NODE_URL}`);
        logInfo('Main', `Oracle Address: ${process.env.PRICE_ORACLE_ADDRESS}`);
        
        await startCronScheduler();
        
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

app.get('/health', (req, res) => {
    const status = healthMonitor.getStatus();
    const statusCode = healthMonitor.isHealthy() ? 200 : 503;
    res.status(statusCode).json({
        ...status,
        version: packageJson.version
    });
});

app.listen(PORT, () => {
    logInfo('HealthCheck', `/health endpoint listening on port ${PORT}`);
});

// Start the service
main(); 