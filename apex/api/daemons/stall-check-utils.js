const {ConnectionError} = require("sequelize");

const winston = require('winston-color');
const models = require('../models');
const Promise = require('bluebird');
const rp = require('request-promise');
const moment = require('moment');

const config = require('../config/app.config');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";


async function singleCheck() {
    try {
        await executeCheck();
        winston.info('Stall check made at ' + moment().format());
    } catch (err) {
        winston.error('Stall check error: ' + err.message);
    }
}

function executeCheck() {
    return new Promise(async (resolve, _void) => {

        try {
            // Get the current block counts from Prometheus
            const validBlocksCount_current = await getVmBlocksValid();
            const pendingTxsCount_current = await getBaggerPending();

            // Get the previous block counts from DB
            const validBlocksCount_prev_fromDB = await models.StallStat.findOne({
                where: {blockType: 'Valid'},
                order: [ [ 'createdAt', 'DESC' ]],
            });
            const pendingTxsCount_prev_fromDB = await models.StallStat.findOne({
                where: {blockType: 'Pending'},
                order: [ [ 'createdAt', 'DESC' ]],
            })

            // If executing for the very first time - no previous data exists in database, so using current values as previous.
            const validBlocksCount_prev = (validBlocksCount_prev_fromDB) ? validBlocksCount_prev_fromDB.dataValues.blockCount : validBlocksCount_current;
            const pendingTxsCount_prev = (pendingTxsCount_prev_fromDB) ? pendingTxsCount_prev_fromDB.dataValues.blockCount : pendingTxsCount_current;
            await createStallStats(validBlocksCount_current, pendingTxsCount_current);
            const currentStallHealthData = await getCurrentHealth(pendingTxsCount_prev, pendingTxsCount_current, validBlocksCount_prev, validBlocksCount_current);
            await updateCurrentStallStat(currentStallHealthData);
            return resolve();

        } catch (error) {
            // if (error instanceof TypeError){
            //     winston.info(`Cannot detect installing state at the first check`)
            // } else {
            if (error instanceof ConnectionError){
                winston.warn(`Error ${error.message ? error.message : ''} occurred while querying stalling status`);
                setTimeout(executeCheck, 3000);
            }
                winston.warn(`Error ${error.message ? error.message : ''} occurred while querying stalling status`);
           // }
            return resolve();
        }
    }).timeout(config.healthCheck.requestTimeout - 80);
}

/**
 * Get number of confirmed blocks in the VM
 * @returns {number}
 */
async function getVmBlocksValid() {
    if (!process.env['PROMETHEUS_HOST']) {
      throw Error('PROMETHEUS_HOST env var is not set - unable to get prometheus data');
    }
  
    const options = {
        method: 'GET',
        url: `http://${process.env['PROMETHEUS_HOST']}/prometheus/api/v1/query?query=vm_blocks_valid`,
        followRedirects: false,
        timeout: config.healthCheck.requestTimeout-100,
        json: true,
    };

    const response = await rp(options);

    if (response.data.result.length == 0) {

        winston.warn(`Metrics will only be generated after the initiation of the first transaction`);
        return 0;
    }
    try {
        return response.data.result[0].value[1];
    } catch (error) {
        winston.warn(`Error ${error.message ? error.message : ''} occurred while querying vm blocks valid`);
    }
}

/**
 * Get number of pending transactions in bagger (unprocessed/unconfirmed transactions)
 * @returns {number}
  */
async function getBaggerPending() {
    if (!process.env['PROMETHEUS_HOST']) {
      throw Error('PROMETHEUS_HOST env var is not set - unable to get prometheus data');
    }
    
    const options = {
        method: 'GET',
        url: `http://${process.env['PROMETHEUS_HOST']}/prometheus/api/v1/query?query=vm_bagger_txs`,
        followRedirects: false,
        timeout: config.healthCheck.requestTimeout-100,
        json: true,
    };

    const response = await rp(options);
    if (response.data.result.length == 0) {
        winston.warn(`Metrics will only be generated after the initiation of the first transaction`);
        return 0;
    }
    try {
        return response.data.result[0].value[1];   //to confirm if pending is at index 0 always
    } catch (error) {
        winston.warn(`Error ${error.message ? error.message : ''} occurred while querying vm blocks pending`);
    }
}

async function getCurrentHealth(pendingTxsCount_prev, pendingTxsCount_current, validBlocksCount_prev, validBlocksCount_current){
    // If previous check had pending transactions and the current check has the same number of valid blocks as the previous node - the network is considered stalled
    // TODO: Potential flaw - what if the prev pending transaction got discarded and the current pending transactions are just new pending to be processed?
    const stallHealthStatus = ! (pendingTxsCount_prev > 0 && pendingTxsCount_current > 0 && validBlocksCount_current === validBlocksCount_prev);
    const validBlocksCountIncreased = validBlocksCount_current > validBlocksCount_prev;
    const hasPendingTxs = pendingTxsCount_current > 0
    return {stallHealthStatus, validBlocksCountIncreased, hasPendingTxs}
}

async function updateCurrentStallStat(currentStallHealthData){
    let currentTime = Date.now();
    const [affectedRows] = await models.CurrentHealth.update(
        {
            latestCheckTimestamp: currentTime,
            latestHealthStatus: currentStallHealthData.stallHealthStatus,
            validBlocksIncreased: currentStallHealthData.validBlocksCountIncreased,
            lastFailureTimestamp: currentStallHealthData.stallHealthStatus ? undefined : currentTime, // do not update if not stalling ('undefined' to skip property)
            hasPendingTxs: currentStallHealthData.hasPendingTxs,
        },
        {
            where: {processName: 'StallStat'},
            returning: true,
        }
    );
    // When running for the first time - create instead of updating:
    if (affectedRows < 1) {
        await models.CurrentHealth.create({
            processName: 'StallStat',
            latestHealthStatus: currentStallHealthData.stallHealthStatus,
            latestCheckTimestamp: currentTime,
            lastFailureTimestamp: currentTime,   //default first time marked as failure
            validBlocksIncreased: currentStallHealthData.validBlocksCountIncreased,
            hasPendingTxs: currentStallHealthData.hasPendingTxs
        });
    }
}

async function createStallStats(blocksValid, blocksPending){
    let currentTime = Date.now();
    await Promise.all([
        models.StallStat.create({
            blockType: "Valid",
            blockCount: blocksValid,
            timestamp: currentTime
        }),
        models.StallStat.create({
            blockType: "Pending",
            blockCount: blocksPending,
            timestamp: currentTime
        })
    ])
}

module.exports = {
    singleCheck,
    getCurrentHealth,
    updateCurrentStallStat,
}
