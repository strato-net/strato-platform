/**
 * Daily Network Metrics Notification Lambda
 *
 * Queries CloudWatch metrics for the past 24 hours and sends a summary
 * notification to SNS topic, which forwards to Slack via Amazon Q.
 *
 * Metrics collected:
 * - Average sync time per block (Testnet/Mainnet)
 * - Average total sync time (Testnet/Mainnet)
 * - Average transaction duration (Oracle)
 */

const { CloudWatchClient, GetMetricStatisticsCommand } = require('@aws-sdk/client-cloudwatch');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');

const cloudwatch = new CloudWatchClient({ region: process.env.AWS_REGION || 'us-east-1' });
const sns = new SNSClient({ region: process.env.AWS_REGION || 'us-east-1' });

const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN;

/**
 * Get average metric value from CloudWatch for the past 24 hours
 */
async function getMetricAverage(namespace, metricName, unit = 'Seconds') {
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000); // 24 hours ago

    const command = new GetMetricStatisticsCommand({
        Namespace: namespace,
        MetricName: metricName,
        StartTime: startTime,
        EndTime: endTime,
        Period: 86400, // 24 hours in seconds
        Statistics: ['Average'],
        Unit: unit,
    });

    try {
        const response = await cloudwatch.send(command);

        if (response.Datapoints && response.Datapoints.length > 0) {
            // Get the most recent datapoint
            const datapoint = response.Datapoints.sort((a, b) => b.Timestamp - a.Timestamp)[0];
            return datapoint.Average;
        }

        return null;
    } catch (error) {
        console.error(`Error fetching metric ${namespace}/${metricName}:`, error);
        return null;
    }
}

/**
 * Format time value for display
 */
function formatTime(seconds) {
    if (seconds === null || seconds === undefined) {
        return 'No data';
    }

    if (seconds < 1) {
        return `${(seconds * 1000).toFixed(2)} ms`;
    }

    if (seconds < 60) {
        return `${seconds.toFixed(2)} seconds`;
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = (seconds % 60).toFixed(0);
    return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Main Lambda handler
 */
exports.handler = async (event) => {
    console.log('Starting daily metrics collection...');

    try {
        // Fetch all metrics in parallel
        const [
            testnetSyncTime,
            testnetSyncTimePerBlock,
            mainnetSyncTime,
            mainnetSyncTimePerBlock,
            txDuration,
        ] = await Promise.all([
            getMetricAverage('Testnet/Synctest/TimeMins', 'TestnetSyncTime'),
            getMetricAverage('Testnet/Synctest/TimePerBlockSec', 'TestnetSyncTimePerBlock'),
            getMetricAverage('Mainnet/Synctest/TimeMins', 'MainnetSyncTime'),
            getMetricAverage('Mainnet/Synctest/TimePerBlockSec', 'MainnetSyncTimePerBlock'),
            getMetricAverage('Testnet/Oracle/Transactions', 'TransactionDuration'),
        ]);

        // Build notification message
        const message = `
📊 *Daily Network Metrics Report*
_Last 24 hours_

*Testnet Sync Metrics*
• Average sync time per block: ${formatTime(testnetSyncTimePerBlock)}
• Average total sync time: ${formatTime(testnetSyncTime)}

*Mainnet Sync Metrics*
• Average sync time per block: ${formatTime(mainnetSyncTimePerBlock)}
• Average total sync time: ${formatTime(mainnetSyncTime)}

*Transaction Metrics*
• Average transaction time: ${formatTime(txDuration)}

---
Generated: ${new Date().toISOString()}
`.trim();

        console.log('Metrics collected:', {
            testnetSyncTime,
            testnetSyncTimePerBlock,
            mainnetSyncTime,
            mainnetSyncTimePerBlock,
            txDuration,
        });

        // Send to SNS topic
        if (!SNS_TOPIC_ARN) {
            throw new Error('SNS_TOPIC_ARN environment variable not set');
        }

        await sns.send(new PublishCommand({
            TopicArn: SNS_TOPIC_ARN,
            Subject: 'Daily Network Metrics Report',
            Message: message,
        }));

        console.log('Successfully sent metrics notification to SNS');

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'Daily metrics notification sent successfully',
                metrics: {
                    testnetSyncTime,
                    testnetSyncTimePerBlock,
                    mainnetSyncTime,
                    mainnetSyncTimePerBlock,
                    txDuration,
                },
            }),
        };
    } catch (error) {
        console.error('Error in daily metrics notification:', error);

        // Send error notification
        try {
            await sns.send(new PublishCommand({
                TopicArn: SNS_TOPIC_ARN,
                Subject: '⚠️ Daily Metrics Report - Error',
                Message: `Failed to generate daily metrics report:\n\n${error.message}\n\nTimestamp: ${new Date().toISOString()}`,
            }));
        } catch (snsError) {
            console.error('Failed to send error notification to SNS:', snsError);
        }

        throw error;
    }
};
