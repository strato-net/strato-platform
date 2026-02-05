import { WebClient } from '@slack/web-api';
import { logInfo } from './logger';

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_CHANNEL = process.env.SLACK_WARNING_CHANNEL || '#ops-monitoring';

let slackClient: WebClient | null = null;

if (SLACK_BOT_TOKEN) {
    slackClient = new WebClient(SLACK_BOT_TOKEN);
    console.log(`[SlackNotifier] Initialized - warnings will be sent to ${SLACK_CHANNEL}`);
} else {
    console.log('[SlackNotifier] SLACK_BOT_TOKEN not set - Slack notifications disabled');
}

function getWarningEmoji(message: string): string {
    if (message.toLowerCase().includes('price change')) return ':chart_with_upwards_trend:';
    if (message.toLowerCase().includes('divergence')) return ':scales:';
    if (message.toLowerCase().includes('failed')) return ':x:';
    return ':warning:';
}

export async function sendWarningToSlack(context: string, message: string, timestamp: string): Promise<void> {
    if (!slackClient) return;

    const emoji = getWarningEmoji(message);

    await slackClient.chat.postMessage({
        channel: SLACK_CHANNEL,
        text: `${emoji} Oracle Warning: ${message.slice(0, 100)}...`,
        blocks: [
            {
                type: 'header',
                text: {
                    type: 'plain_text',
                    text: `${emoji} Oracle Warning`,
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

    logInfo('SlackNotifier', `Warning sent to ${SLACK_CHANNEL}`);
}
