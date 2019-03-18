const winston = require('winston-color');
const models = require('../models');
const Promise = require('bluebird');
const rp = require('request-promise');
const env = process.env.NODE_ENV || 'development';
const moment = require('moment');

const config = require('../config/app.config');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

winston.info('Starting uptime-check with a delay of', config.healthCheck.uptimeProgressWindow);
setInterval(async () => {
    try {
        await queryHealthStatus();
winston.info('Uptime Status Checked at ' + moment().format());
} catch (err) {
    winston.error(' Uptime Check error: ' + err.message);
}
}, config.healthCheck.uptimeProgressWindow);


function queryHealthStatus() {
    return new Promise(async (resolve, _void) => {

        try {
            const blocksValid = await getVmBlocksValid();
            const blocksPending = await getBaggerPending();
            let currentTime = moment().format();
            const lastBlocksValid = await models.Uptime.findOne({
                where: {
                    blockType: "Valid",
                },
                order: [ [ 'createdAt', 'DESC' ]],
            });
            const lastBlocksPending = await models.Uptime.findOne({
                where: {
                    blockType: "Pending",
                },
                order: [ [ 'createdAt', 'DESC' ]],
            });

            await models.Uptime.create({
                blockType: "Valid",
                blockCount: blocksValid,
                timestamp: currentTime
            });

            await models.Uptime.create({
                blockType: "Pending",
                blockCount: blocksPending,
                timestamp: currentTime
            });

            // The only unmatch case: lastPendingBlock is nonzero but there is no increment in blocksValid (See spec - uptime sheet)
            const overallStat = lastBlocksPending > 0 && blocksValid == lastBlocksValid.blockCount ? false : true;
            const blocksValidInc = blocksValid > lastBlocksValid.blockCount;
            await models.Stat.findOrCreate({where: {processName: 'Uptime'}, defaults: {
                latestHealthStatus: overallStat,
                latestCheckTimestamp: currentTime,
                lastFailureTimestamp: overallStat ? null : currentTime,
                ifBlocksValidInc: blocksValidInc
            }}).then(([stat, created]) => {
                if (!created){
                    stat.update(
                        {latestCheckTimestamp: currentTime,
                            latestHealthStatus: overallStat,
                            ifBlocksValidInc: blocksValidInc,
                            lastFailureTimestamp: overallStat ? stat.lastFailureTimestamp : currentTime
                        }, {where: {processName: 'Uptime'}})
                }}).catch(err => {
                    winston.warn(`Error ${err.message ? err.message : ''} occurred while creating and updating tables`);
                });
          return resolve();
        } catch (error) {
            winston.warn(`Error ${error.message ? error.message : ''} occurred while querying uptime status`);
            return resolve();
        }
    }).timeout(config.healthCheck.requestTimeout - 80);
}

async function getVmBlocksValid() {
    const options = {
        method: 'GET',
        url: `http://localhost/prometheus/api/v1/query?query=vm_blocks_valid`,
        followRedirects: false,
        timeout: config.healthCheck.requestTimeout-100,
        json: true,
        // TODO: Modify to work with secured networks
        auth: {
            'user': 'admin',
            'pass': 'admin'
        }
    };

    const response = await rp(options);

    if (response.data.result.length == 0) {

        winston.warn(`Metrics will only be generated after the initiation of the first transaction`);
        return 0;
    }

    try {
        const blockCount = response.data.result[0].value[1];
        return blockCount
    } catch (error) {
        winston.warn(`Error ${error.message ? error.message : ''} occurred while querying vm blocks valid`);
    }
}

async function getBaggerPending() {
    const options = {
        method: 'GET',
        url: `http://localhost/prometheus/api/v1/query?query=vm_bagger_txs`,
        followRedirects: false,
        timeout: config.healthCheck.requestTimeout-100,
        json: true,
        // TODO: Modify to work with secured networks
        auth: {
            'user': 'admin',
            'pass': 'admin'
        }
    };

    const response = await rp(options);

    try {
        const blockCount = response.data.result[0].value[1];   //to confirm if pending is at index 0 always
        return blockCount;
    } catch (error) {
        winston.warn(`Error ${error.message ? error.message : ''} occurred while querying vm blocks pending`);
    }
}
