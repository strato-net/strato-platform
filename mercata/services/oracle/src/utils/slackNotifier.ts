import { WebClient } from '@slack/web-api';
import { logInfo } from './logger';

let slackClient: WebClient | null = null;
let initialized = false;

function getSlackClient(): WebClient | null {
    if (initialized) return slackClient;

    initialized = true;
    const token = process.env.SLACK_BOT_TOKEN;

    if (token) {
        slackClient = new WebClient(token);
        const channel = process.env.SLACK_WARNING_CHANNEL || '#ops-monitoring';
        console.log(`[SlackNotifier] Initialized - warnings will be sent to ${channel}`);
    } else {
        console.log('[SlackNotifier] SLACK_BOT_TOKEN not set - Slack notifications disabled');
    }

    return slackClient;
}

function getWarningEmoji(message: string): string {
    if (message.toLowerCase().includes('price change')) return ':chart_with_upwards_trend:';
    if (message.toLowerCase().includes('divergence')) return ':scales:';
    if (message.toLowerCase().includes('failed')) return ':x:';
    return ':warning:';
}

export async function sendWarningToSlack(context: string, message: string, timestamp: string): Promise<void> {
    const client = getSlackClient();
    if (!client) return;

    const channel = process.env.SLACK_WARNING_CHANNEL || '#ops-monitoring';
    const oracleName = process.env.ORACLE_NAME || 'Dev Oracle';
    const emoji = getWarningEmoji(message);

    await client.chat.postMessage({
        channel,
        text: `${emoji} ${oracleName} - Warning: ${message.slice(0, 100)}...`,
        blocks: [
            {
                type: 'header',
                text: {
                    type: 'plain_text',
                    text: `${emoji} ${oracleName} - Warning`,
                    emoji: true
                }
            },
            {
                type: 'section',
                fields: [
                    {
                        type: 'mrkdwn',
                        text: `*Context:*\n${context}`
                    },
                    {
                        type: 'mrkdwn',
                        text: `*Timestamp:*\n${timestamp}`
                    }
                ]
            },
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `*Message:*\n\`\`\`${message}\`\`\``
                }
            },
            {
                type: 'divider'
            }
        ]
    });

    logInfo('SlackNotifier', `Warning sent to ${channel}`);
}
