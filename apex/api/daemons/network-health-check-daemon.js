const winston = require('winston-color');

const config = require('../config/app.config');
const singleCheck = require('./network-health-check-utils')['singleCheck'];


// DAEMON - query network-health-check every N sec
winston.info('Starting network-health-check with a delay of', config.networkHealthCheck.pollFrequency);

(async () => {
  await singleCheck()
  setInterval(async () => {
    await singleCheck()
  }, config.networkHealthCheck.pollFrequency);
})();
