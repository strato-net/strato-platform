const winston = require('winston-color');
const models = require('../models');
const config = require('../config/app.config');
const moment = require('moment');

cleanOnce();
setInterval(cleanOnce, config.healthCheck.cleanFrequency);

async function cleanOnce() {
        winston.info('Cleaning HealthStats Data');
        const mDate = moment().subtract(config.healthCheck.retention, "hours");
        await models.HealthStat.destroy({
            where:{
                createdAt: {
                    $lt: mDate
                }
            }
        }).then(destroyedCount => {
            winston.info(`CLEANUP - HealthStat: Completed on ${moment().format()} - cleaned ${destroyedCount} rows`);
            return resolve();
        }).catch(err => {
        winston.error('CLEANUP - HealthStat: Failed with error: ' + err.message);
        })

        winston.info('Cleaning StallStats Data');
        await models.StallStat.destroy({
            where:{
                createdAt: {
                    $lt: mDate
                }
            }
        }).then(destroyedCount => {
            winston.info(`CLEANUP - StallStats: Completed on ${moment().format()} - cleaned ${destroyedCount} rows`);
            return resolve();
        }).catch(err => {
        winston.error('CLEANUP - StallStats: Failed with error: ' + err.message);
        })

}



