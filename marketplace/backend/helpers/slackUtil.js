const { IncomingWebhook } = require('@slack/webhook');

const webhookUrl = process.env.SLACK_URL
async function slackMessage(username, message) {
  const payload = {
    channel: '#the-core',
    username: username,
    text: message,
    // icon_emoji: ':ghost:'
  }
  try {
    const webhook = new IncomingWebhook(webhookUrl);
    await webhook.send(payload);
    // console.log('Payload sent to Slack successfully.');
    return true;
  } catch (error) {
    console.error('Error sending payload to Slack:', error);
    return false;
  }
}

module.exports = slackMessage;
