const winston = require('winston-color');
const models = require('../models');
const config = require('../config/app.config');
const moment = require('moment');
const { Op } = require('sequelize');

(async () => {
  await cleanOnce();
  setInterval(await cleanOnce, config.healthCheck.cleanFrequency);
})()

async function cleanOnce() {
  const mDateHealth = moment().subtract(config.healthCheck.retentionHours, "hours");
  // Unused code notice. Node stats disabled, to be deprecated  #node-stats-deprecation
  // const mDateApiCallCounter = moment().subtract(config.statistics.apiCallCounterRetentionHours, "hours");

  winston.info('Cleaning the historical DB Data (HealthStats, StallStats');
  
  // We could use Promise.allSettled but do we really want to destroy data in multiple tables in parallel?
  try {
    const destroyedCount = await models.HealthStat.destroy({
      where: {
        createdAt: {
          [Op.lt]: mDateHealth
        }
      }
    })
    winston.info(`Cleanup - HealthStats: Completed on ${moment().format()} - cleaned ${destroyedCount} rows`);
  } catch(err) {
    winston.error('Cleanup - HealthStats: Failed with error: ' + err.message);
  }

  try {
    const destroyedCount = await models.StallStat.destroy({
      where: {
        createdAt: {
          [Op.lt]: mDateHealth
        }
      }
    })
    winston.info(`Cleanup - StallStats: Completed on ${moment().format()} - cleaned ${destroyedCount} rows`);
  } catch(err) {
    winston.error('Cleanup - StallStats: Failed with error: ' + err.message);
  }
  
  // Unused code notice. Node stats disabled, to be deprecated  #node-stats-deprecation
  // try {
  //   const destroyedCount = await models.ApiCallCount.destroy({
  //     where: {
  //       createdAt: {
  //         [Op.lt]: mDateApiCallCounter
  //       }
  //     }
  //   })
  //   winston.info(`Cleanup - ApiCallCounts: Completed on ${moment().format()} - cleaned ${destroyedCount} rows`);
  // } catch(err) {
  //   winston.error('Cleanup - ApiCallCounts: Failed with error: ' + err.message);
  // }
}
