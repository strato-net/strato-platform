const {ConnectionError} = require("sequelize");

const winston = require('winston-color');
const models = require('../models');
const Promise = require('bluebird');
const rp = require('request-promise');
const env = process.env.NODE_ENV || 'development';
const moment = require('moment');

const config = require('../config/app.config');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

setTimeout(queryHealthStatus, config.healthCheck.initialDatabaseTimout);
setInterval(queryHealthStatus, config.healthCheck.progressWindow);


function queryHealthStatus() {
    winston.info('Stalling Status Checked at ' + moment().format());
    return new Promise(async (resolve, _void) => {

        try {
            const blocksValid = await getVmBlocksValid();
            const blocksPending = await getBaggerPending();

            const lastBlocksValid = await models.StallStat.findOne({
                where: {blockType: 'Valid'},
                order: [ [ 'createdAt', 'DESC' ]],
            });
            const lastBlocksPending = await models.StallStat.findOne({
                where: {blockType: 'Pending'},
                order: [ [ 'createdAt', 'DESC' ]],
            })

            const lastV = (lastBlocksValid) ? lastBlocksValid.dataValues.blockCount : blocksValid;
            const lastP = (lastBlocksPending) ? lastBlocksPending.dataValues.blockCount : blocksPending;

            await updateStallStat(blocksValid, blocksPending);
            const overallStat = await getCurrentHealth(lastP, lastV, blocksValid);

            await updateCurrentHealth(overallStat);

            return resolve();

            } catch (error) {
                // if (error instanceof TypeError){
                //     winston.info(`Cannot detect installing state at the first check`)
                // } else {
                if (error instanceof ConnectionError){
                    winston.warn(`Error ${error.message ? error.message : ''} occurred while querying stalling status`);
                    setTimeout(queryHealthStatus, 3000);
                }
                    winston.warn(`Error ${error.message ? error.message : ''} occurred while querying stalling status`);
               // }
                return resolve();
            }
    }).timeout(config.healthCheck.requestTimeout - 80);
}

async function getVmBlocksValid() {
    const ipaddr = (env == 'production') ? 'prometheus:9090' : 'localhost';
    const options = {
        method: 'GET',
        url: `http://${ipaddr}/prometheus/api/v1/query?query=vm_blocks_valid`,
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
    const ipaddr = (env == 'production') ? 'prometheus:9090' : 'localhost';
    const options = {
        method: 'GET',
        url: `http://${ipaddr}/prometheus/api/v1/query?query=vm_bagger_txs`,
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
        const blockCount = response.data.result[0].value[1];   //to confirm if pending is at index 0 always
        return blockCount;
    } catch (error) {
        winston.warn(`Error ${error.message ? error.message : ''} occurred while querying vm blocks pending`);
    }
}

async function getCurrentHealth(lastP, lastV, thisV){
    // The only unmatch case: lastPendingBlock is nonzero but there is no increment in blocksValid (See spec - uptime sheet)
    const overallStat = !(lastP > 0 && thisV == lastV);
    const blocksValidInc = thisV > lastV;
    return [overallStat, blocksValidInc, (lastP > 0)]
}

async function updateCurrentHealth(overallStat){
    let currentTime = Date.now();
    await models.CurrentHealth.findOrCreate({where: {processName: 'StallStat'}, defaults: {
            latestHealthStatus: overallStat[0],
            latestCheckTimestamp: currentTime,
            lastFailureTimestamp: currentTime,   //default first time marked as failure
            isBlocksValidInc: overallStat[1],
            isLastPending: overallStat[2]
        }}).then(([stat, created]) => {
            if (!created){
                stat.update(
                    {latestCheckTimestamp: currentTime,
                     latestHealthStatus: overallStat[0],
                     isBlocksValidInc: overallStat[1],
                     lastFailureTimestamp: overallStat[0] ? stat.lastFailureTimestamp : currentTime,
                     isLastPending:    overallStat[2]
                    }, {where: {processName: 'StallStat'}})
        }}).catch(err => {
        winston.warn(`Error ${err.message ? err.message : ''} occurred while creating and updating tables`);
    });
}

async function updateStallStat(blocksValid, blocksPending){
    let currentTime = Date.now();
    await models.StallStat.create({
        blockType: "Valid",
        blockCount: blocksValid,
        timestamp: currentTime
    });

    await models.StallStat.create({
        blockType: "Pending",
        blockCount: blocksPending,
        timestamp: currentTime
    });
}

async function initialCreate(){
  let currentTime = Date.now();
  await models.CurrentHealth.findOrCreate({where: {processName: 'StallStat'}, defaults: {
      latestHealthStatus: true,
      latestCheckTimestamp: currentTime,
      lastFailureTimestamp: currentTime,   //default first time marked as failure
      isBlocksValidInc: false,
      isLastPending: false
    }})
}

module.exports = {
    getCurrentHealth,
    updateStallStat,
    updateCurrentHealth
}
