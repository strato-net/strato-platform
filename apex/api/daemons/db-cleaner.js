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
        models.healthStat.destroy({
            where:{
                createdAt: {
                    $lt: mDate
                }
            }
        }).then(destroyedCount => {
            winston.info(`CLEANUP - healthStat: Completed on ${moment().format()} - cleaned ${destroyedCount} rows`);
            return resolve();
        }).catch(err => {
        winston.error('CLEANUP - healthStat: Failed with error: ' + err.message);
        return resolve();
        })

        winston.info('Cleaning StallChecks Data');
        const mDate = moment().subtract(config.healthCheck.retention, "hours");
        models.StallCheck.destroy({
            where:{
                createdAt: {
                    $lt: mDate
                }
            }
        }).then(destroyedCount => {
            winston.info(`CLEANUP - stallCheck: Completed on ${moment().format()} - cleaned ${destroyedCount} rows`);
            return resolve();
        }).catch(err => {
        winston.error('CLEANUP - stallCheck: Failed with error: ' + err.message);
        return resolve();
        })
    })
}



