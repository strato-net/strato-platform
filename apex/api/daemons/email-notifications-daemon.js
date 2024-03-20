const winston = require('winston-color');

const config = require('../config/app.config');
const utils = require("../lib/utils");
import { getLatestHealth } from '../controllers/health'

if (!process.env['ADMIN_EMAIL']) {
  winston.info('ADMIN_EMAIL is not provided. Email notifications about node health are disabled.');
  process.exit(0)
}

// DAEMON - query network-health-check every N sec
winston.info('Starting email-notifications-daemon with a delay of', config.emailNotifications.pollFrequency);

(async () => {
  await singleCheck()
  setInterval(async () => {
    await singleCheck()
  }, config.emailNotifications.pollFrequency);
})();


async function singleCheck() {
  let health = null;
  try {
    const [healthInfo, stallInfo, systemInfo, syncInfo] =
        await getLatestHealth();
    
    if (healthInfo && stallInfo && systemInfo && syncInfo) {
      [{health}] = utils.consolidateHealthData(
          healthInfo,
          stallInfo,
          systemInfo,
          syncInfo
      );
    } else {
      winston.warn(
          `Health table has no entries; Health endpoint is called too soon`
      );
    }
  } catch (error) {
    winston.error(error);
    return next(new Error("Unable to collect some of the health info."));
  }
  winston.warn('No logic implemented here yet. Health is: ', health)
  if (!health) {
    // TODO: logic here to raise the attention flag and send an email
  } else {
    //TODO: logic here to remove previously raised attention flag
  }

}
