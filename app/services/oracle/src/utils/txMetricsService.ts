/**
 * Transaction Metrics Service
 * 
 * Records oracle transaction timing data to AWS CloudWatch.
 * Captures transaction duration for each price update transaction.
 */

import dotenv from 'dotenv';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { TxMetric } from '../types';
import { logError, logInfo } from './logger';

dotenv.config();

/**
 * CloudWatch client
 * Uses AWS credentials from environment or IAM role
 */
const client = new CloudWatchClient({
    region: process.env.AWS_REGION || 'us-east-1',
});

const NAMESPACE = process.env.CLOUDWATCH_NAMESPACE;

/**
 * Transaction Metrics Service
 * Sends transaction timing metrics to CloudWatch (only if CLOUDWATCH_NAMESPACE is configured)
 */
class TxMetricsService {
    /**
     * Records a transaction metric to CloudWatch
     * 
     * @param metric - Transaction timing data including hash, timestamps, duration, and status
     * 
     * Skips recording if CLOUDWATCH_NAMESPACE is not set.
     * Errors are caught and logged but do not affect oracle operation.
     */
    async recordTxMetric(metric: TxMetric): Promise<void> {
        if (!NAMESPACE) {
            return;
        }

        try {
            await client.send(new PutMetricDataCommand({
                Namespace: NAMESPACE,
                MetricData: [{
                    MetricName: 'TransactionDuration',
                    Value: metric.duration / 1000,  // Convert ms to seconds
                    Unit: 'Seconds',
                    Timestamp: new Date(),
                }],
            }));

            logInfo(
                'TxMetricsService',
                `Recorded metric: txHash=${metric.txHash}, duration=${metric.duration}ms, status=${metric.status}`
            );
        } catch (error) {
            const err = error as Error;
            logError('TxMetricsService', new Error(`Failed to call AWS CloudWatch PutMetricData (namespace: ${NAMESPACE}): ${err.message}`));
        }
    }
}

export const txMetricsService = new TxMetricsService();
