/**
 * Transaction Metrics Service
 * 
 * Records oracle transaction timing data to PostgreSQL database.
 * Captures submit time, confirmation time, and duration for each price update transaction.
 */

import { Pool } from 'pg';
import { TxMetric } from '../types';
import { logError, logInfo } from './logger';

/**
 * PostgreSQL connection pool
 * Maintains up to 5 reusable database connections
 */
const pool = new Pool({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    max: 5,
});

/**
 * Transaction Metrics Service
 * Handles recording of transaction timing data to the database
 */
class TxMetricsService {
    /**
     * Records a transaction metric to the database
     * 
     * @param metric - Transaction timing data including hash, timestamps, duration, and status
     * 
     * Errors are caught and logged but do not affect oracle operation.
     */
    async recordTxMetric(metric: TxMetric): Promise<void> {
        try {
            await pool.query(
                `INSERT INTO tx_metrics 
                    (ts, tx_hash, submit_time_ms, confirm_time_ms, duration_ms, status, asset_count)
                 VALUES 
                    ($1, $2, $3, $4, $5, $6, $7)`,
                [
                    metric.timestamp,
                    metric.txHash,
                    metric.submitTime,
                    metric.confirmTime,
                    metric.duration,
                    metric.status,
                    metric.assetCount ?? 0,
                ]
            );

            logInfo(
                'TxMetricsService',
                `Recorded metric: txHash=${metric.txHash}, duration=${metric.duration}ms, status=${metric.status}`
            );
        } catch (error) {
            logError('TxMetricsService', error as Error);
        }
    }
}

export const txMetricsService = new TxMetricsService();

/**
 * Tests database connectivity
 * Called at service startup to ensure database is reachable
 * 
 * @throws Error if database connection fails
 */
export async function testDatabaseConnection(): Promise<void> {
    await pool.query('SELECT 1');
}
