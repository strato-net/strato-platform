const moment = require("moment/moment");
const winston = require('winston-color');
const config = require('../config/app.config');

let emailer
const utils = require("../lib/utils");


/**
 * A temporary implementation for node admin email notification about node's health, based on a business requirement.
 * Ideally the health should be polled by external services to avoid situations when the node is down and is not able to send emails.
  */

if (!process.env['ADMIN_EMAIL']) {
  winston.info('ADMIN_EMAIL is not provided. Email notifications about node health are disabled.');
  process.exit(0)
} else{
  emailer = require('../lib/emailer')
}

let ACTIVE_EMAIL_WARNING_FLAG = false;

(async () => {
  winston.info(`Starting email-notifications-daemon with a delay ${config.emailNotifications.nodeHealthGracePeriod}ms and poll frequency ${config.emailNotifications.pollFrequency}ms`);
  await new Promise(r => setTimeout(r, config.emailNotifications.nodeHealthGracePeriod));
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
  let health = true;
  try {
    const [healthInfo, stallInfo, systemInfo, syncInfo] =
        await utils.getLatestHealth();
    
    if (healthInfo && stallInfo && systemInfo && syncInfo) {
      ({ health, healthIssues } = utils.consolidateHealthData(
          healthInfo,
          stallInfo,
          systemInfo,
          syncInfo
      ));
    } else {
      winston.warn(`Health table has no entries yet; Health endpoint is called too early. Wait until the next iteration.`);
    }
  } catch (error) {
    winston.error(`Error occurred while trying to collect health info: ` + error.message ? error.message : error)
  }
  if (!health) {
    if (!ACTIVE_EMAIL_WARNING_FLAG) {
      // There will only be 1 attempt to send an email because we raise the flag here. This is to avoid spamming the SMTP server with new failing attempts.
      ACTIVE_EMAIL_WARNING_FLAG = true
      winston.warn(`Node appears to require admin's attention. Active email warning flag raised. Attempting to send an email...`);
      const _ = await emailer.sendEmail(
          to=process.env['ADMIN_EMAIL'], 
          subject="STRATO Mercata node requires attention",
          text=`Your STRATO Mercata node is unhealthy or has warnings. ${healthIssues}. Please visit Dashboard at '/dashboard' and '/apex-api/status' endpoint (requires the dashboard authentication first) for more information.`,
          html=`<p>Your STRATO Mercata node is unhealthy or has warnings.<br/>${healthIssues}.<br/>Please visit Dashboard at '/dashboard' and '/apex-api/status' endpoint (requires the dashboard authentication first) for more information.</p>`
      )
      winston.warn(`Email notification about node health was successfully sent to ${process.env['ADMIN_EMAIL']}`)
      // 
    }
  } else {
    if (ACTIVE_EMAIL_WARNING_FLAG) {
      ACTIVE_EMAIL_WARNING_FLAG = false
      winston.warn(`Active email warning flag LIFTED. Node is now healthy.`);
    }
  }
}
