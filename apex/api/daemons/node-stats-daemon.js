const winston = require('winston-color');

const config = require('../config/app.config');
const models = require('../models');
const statsUtils = require('./node-stats-utils');

if (process.env.STATS_ENABLED === "true") {
  // DAEMON - query stats on a cron-like schedule
  winston.info('Starting node usage stats daemon');

  (async () => {
    const statsDaemon = new statsUtils.StatsDaemon()
    await statsDaemon.init()

    async function collectAndSubmit() {
      await statsDaemon.collectStats()
      if (process.env.STATS_SUBMIT_ENABLED === 'true') {
        await new Promise(r => setTimeout(r, Math.floor(Math.random() * 4000)));
        await statsDaemon.submitStats()
      }
    }

    // Uncomment and use this single call for debugging:
    // await collectAndSubmit()

    setInterval(async () => {
          const date = new Date()
          const lastStat = await models.UsageStat.findOne({
            order: [['createdAt', 'DESC']],
            attributes: ['createdAt', 'timestamp']
          })
          if (
              (
                  date.getUTCHours() === config.statistics.collectSubmitUTCTimeOfDay.hours &&
                  date.getUTCMinutes() === config.statistics.collectSubmitUTCTimeOfDay.minutes
              ) ||
              lastStat && (new Date() - lastStat.timestamp > 24 * 60 * 60 * 1000) ||
              ['test', 'development'].includes(process.env.NODE_ENV)

          ) {
            await collectAndSubmit()
          }
        },
        ['test', 'development'].includes(process.env.NODE_ENV) 
            ? 5 * 1000 // every 5sec in dev and for tests
            : 60 * 1000 // every 1 minute in prod
    );
  })();
} else {
  winston.info('STATS feature is disabled on this node')
}
