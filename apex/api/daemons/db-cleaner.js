const winston = require('winston-color');
const models = require('../models');
const config = require('../config/app.config');
const moment = require('moment');

cleanOnce();
setInterval(cleanOnce, config.healthCheck.cleanFrequency);

function cleanOnce() {
    return new Promise(async (resolve) => {
        winston.info('Cleaning HealthStats Data');
        const mDate = moment().subtract(config.healthCheck.retention, "hours");
        models.HealthStat.destroy({
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
        return resolve();
        })

        winston.info('Cleaning StallStats Data');
        models.StallStat.destroy({
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
        return resolve();
        })
    })
}



