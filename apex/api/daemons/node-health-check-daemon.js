const winston = require('winston-color');

const config = require('../config/app.config');
const singleCheck = require('./node-health-check-utils')['singleCheck'];


// DAEMON - query node-health-check every N sec
winston.info('Starting node-health-check with a delay of', config.healthCheck.pollFrequency);

(async () => {
  await singleCheck()
  setInterval(async () => {
    await singleCheck()
  }, config.healthCheck.pollFrequency);
})();
