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
                    $lt: mData
                }
            }
        }).then(destroyedCount => {
            winston.info(`CLEANUP: Completed on ${moment().format()} - cleaned ${destroyedCount} rows`);
            return resolve();
        }).catch(err => {
        winston.error('CLEANUP: Failed with error: ' + err.message);
        return resolve();
        })
    })
}



