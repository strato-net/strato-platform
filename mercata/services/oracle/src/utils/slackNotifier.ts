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
        console.log(`[SlackNotifier] Initialized - warnings and errors will be sent to ${channel}`);
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
        text: `${emoji} *${oracleName}* [${context}] ${message}`,
    });

    logInfo('SlackNotifier', `Warning sent to ${channel}`);
}

export async function sendErrorToSlack(context: string, message: string, timestamp: string): Promise<void> {
    const client = getSlackClient();
    if (!client) return;

    const channel = process.env.SLACK_WARNING_CHANNEL || '#ops-monitoring';
    const oracleName = process.env.ORACLE_NAME || 'Dev Oracle';

    await client.chat.postMessage({
        channel,
        text: `:rotating_light: *${oracleName}* [ERROR] [${context}] ${message}`,
    });

    logInfo('SlackNotifier', `Error sent to ${channel}`);
}
