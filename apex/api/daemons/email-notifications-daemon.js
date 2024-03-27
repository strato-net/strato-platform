const winston = require('winston-color');

const config = require('../config/app.config');
const utils = require("../lib/utils");
const moment = require("moment/moment");


if (!process.env['ADMIN_EMAIL']) {
  winston.info('ADMIN_EMAIL is not provided. Email notifications about node health are disabled.');
  process.exit(0)
}

// DAEMON - query network-health-check every N sec
winston.info('Starting email-notifications-daemon with a delay of', config.emailNotifications.nodeHealthGracePeriod);

(async () => {
  await singleCheck()
  setInterval(async () => {
    await singleCheck()
  }, config.emailNotifications.pollFrequency);
})();


async function singleCheck() {
  try {
    await executeCheck();
    winston.info('Email notifications health check made at ' + moment().format());
  } catch (err) {
    winston.error('Email notifications health check error: ' + err.message);
  }
}
async function executeCheck() {
  let health = null;
  try {
    const [healthInfo, stallInfo, systemInfo, syncInfo] =
        await utils.getLatestHealth();
    
    if (healthInfo && stallInfo && systemInfo && syncInfo) {
      ({ health } = utils.consolidateHealthData(
          healthInfo,
          stallInfo,
          systemInfo,
          syncInfo
      ));
    } else {
      winston.warn(
          `Health table has no entries; Health endpoint is called too soon`
      );
    }
  } catch (error) {
    winston.error(`Error occurred while trying to collect health info: ` + error.message ? error.message : error)
  }
  
  winston.warn('No logic implemented here yet. Health is: ', health)
  if (!health) {
    // TODO: logic here to raise the attention flag and send an email
  } else {
    //TODO: logic here to remove previously raised attention flag
  }

}
