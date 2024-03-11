const winston = require('winston-color');

const config = require('../config/app.config');
const singleCheck = require('./stall-check-utils')['singleCheck'];


// DAEMON - check stall status every N sec
winston.info('Starting stall-check with a delay of', config.healthCheck.stallCheckFrequency);

(async() => {
  await singleCheck()
  setInterval(async () => {
    await singleCheck()
  }, config.healthCheck.stallCheckFrequency);
})();
