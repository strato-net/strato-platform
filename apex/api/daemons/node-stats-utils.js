const axios = require('axios');
const { posix } = require('path');
const { Sequelize, Op } = require('sequelize');
const { URL } = require('url');
const winston = require('winston-color');

const env = process.env.NODE_ENV || 'development';

const config = require('../config/app.config');
const dbconfig = require('../config/config.json')[env];
const models = require('../models');


const sequelizeConnUriPrefix = `postgres://${dbconfig.username}:${dbconfig.password}@${dbconfig.host}:${dbconfig.port}`

class StatsDaemon {
  
  async init() {
    const pgClientVault = new Sequelize(`${sequelizeConnUriPrefix}/oauth`, {logging: (dbconfig.logging ? dbconfig.logging : undefined)})
    const [[ethNameResult], [nodeAddressResult]] = await Promise.all([
      pgClientVault.query("SELECT datname FROM pg_database WHERE datname LIKE '%eth_%'"),
      pgClientVault.query("SELECT address FROM users WHERE x_user_unique_name = 'nodekey'")
    ])
    await pgClientVault.close()

    this.ethDbName = ethNameResult[0]['datname']
    this.nodeAddress = nodeAddressResult[0].address.toString()
  }
  
  async collectStats () {
    const [lastUsageStat, oldestHealthStat] = await Promise.all([
      models.UsageStat.findOne({
        order: [['createdAt', 'DESC']],
      }),
      models.HealthStat.findOne({
        order: [['createdAt', 'ASC']],
        attributes: ['createdAt'],
      })
    ])
    const currentTime = Date.now();
    const oldestKnownStratoTimestampAgeSec =  oldestHealthStat ? Math.floor((currentTime - oldestHealthStat.createdAt) / 1000): null
    const secondsSinceLastStat = lastUsageStat 
        ? Math.floor((currentTime - lastUsageStat.timestamp) / 1000) 
        : Math.max(86400, oldestKnownStratoTimestampAgeSec, Math.floor(process.uptime()))
    const pgClientEth = new Sequelize(`${sequelizeConnUriPrefix}/${this.ethDbName}`, {logging: (dbconfig.logging ? dbconfig.logging : undefined)})
    const pgClientVault = new Sequelize(`${sequelizeConnUriPrefix}/oauth`, {logging: (dbconfig.logging ? dbconfig.logging : undefined)})
    const pgClientCirrus = new Sequelize(`${sequelizeConnUriPrefix}/cirrus`, {logging: (dbconfig.logging ? dbconfig.logging : undefined)})
    
    const [[txsForPeriodResult], [usersCountResult], [cirrusTableListResult, cirrusTableListMetadata]] = await Promise.all([
      pgClientEth.query(`SELECT count(*) FROM raw_transaction AS rt LEFT JOIN transaction_result AS tr ON rt.id=tr.id WHERE rt.timestamp >= now() - INTERVAL '${secondsSinceLastStat} SECONDS' and tr.status='Success'`),
      pgClientVault.query("SELECT count(*) FROM users WHERE x_user_unique_name != 'nodekey'"),
      pgClientCirrus.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename != 'contract' AND tablename != 'cold_storage'"),
    ])
    
    const txsForPeriod = +txsForPeriodResult[0]['count']
    const usersCount = +usersCountResult[0]['count']
    const cirrusTableList = cirrusTableListResult.map((row) => row['tablename'])
    const cirrusTableCount = cirrusTableListMetadata.rowCount
    
    let cirrusTotalFields = 0
    let cirrusContractCountsByType = {}
    for (const tname of cirrusTableList) {
      const [[colsInTableResult], [rowsInTableResult]] = await Promise.all([
        pgClientCirrus.query(`SELECT count(*) FROM information_schema.columns WHERE table_name = '${tname}' AND column_name != 'address' AND column_name != 'chainId' AND column_name != 'block_hash' AND column_name != 'block_timestamp' AND column_name != 'block_number' AND column_name != 'transaction_hash' AND column_name != 'transaction_sender' AND column_name != 'transaction_function_name'`),
        pgClientCirrus.query(`SELECT count(*) FROM \"${tname}\"`),
      ])
      const colsInTable = +colsInTableResult[0]['count']
      const rowsInTable = +rowsInTableResult[0]['count']
      const fieldsInTable = colsInTable * rowsInTable
      cirrusTotalFields += fieldsInTable
      cirrusContractCountsByType[tname] = rowsInTable
    }

    await Promise.all([
      await pgClientEth.close(),
      await pgClientVault.close(),
      await pgClientCirrus.close(),
    ])
    
    const [apiReadsForPeriod, apiWritesForPeriod, lastApiCallCount] = await Promise.all([
      models.ApiCallCount.sum('apiReads', {
        where: {
          createdAt: {
            [Op.gt]: new Date(new Date() - secondsSinceLastStat * 1000 - config.statistics.apiCallCounterDbSaveTimer)
          }
        },
      }),
      models.ApiCallCount.sum('apiReads', {
        where: {
          createdAt: {
            [Op.gt]: new Date(new Date() - secondsSinceLastStat * 1000 - config.statistics.apiCallCounterDbSaveTimer)
          }
        },
      }),
      models.ApiCallCount.findOne({
        order: [['createdAt', 'DESC']],
      })
    ])
    
    await models.UsageStat.create({
      networkTxs: txsForPeriod,
      networkTxsTotal: lastUsageStat ? lastUsageStat.networkTxsTotal + txsForPeriod : txsForPeriod,
      contractTypesAdded: lastUsageStat ? cirrusTableCount - lastUsageStat.contractTypesTotal : cirrusTableCount,
      contractTypesTotal: cirrusTableCount,
      contractCountsByType: cirrusContractCountsByType,
      contractFieldsAdded: lastUsageStat ? cirrusTotalFields - lastUsageStat.contractFieldsTotal : cirrusTotalFields,
      contractFieldsTotal: cirrusTotalFields,
      usersAdded: lastUsageStat ? usersCount - lastUsageStat.usersTotal : usersCount,
      usersTotal: usersCount,
      apiReads: apiReadsForPeriod ? apiReadsForPeriod : 0,
      apiReadsTotal: lastApiCallCount ? lastApiCallCount.apiReadsTotal : 0,
      apiWrites: apiWritesForPeriod ? apiWritesForPeriod : 0,
      apiWritesTotal: lastApiCallCount ? lastApiCallCount.apiWritesTotal : 0,
      periodSec: secondsSinceLastStat,
      timestamp: currentTime,
    });
  }
  async submitStats () {
    const formatResponse = (isSuccess, message) => ({success: isSuccess, message: message})
    
    const unsubmittedStats = await models.UsageStat.findAll({
      where: {submitted: false},
      order: [['id', 'ASC']], // it's default but wanted it to be explicit
    })
    if (unsubmittedStats.length === 0) {
      const msg = 'No stats to submit to BlockApps StatServer'
      winston.error(msg) // it is 'err' because it is an unusual case - submit should only be called after collectStats, however success as no error
      return formatResponse(true, msg)
    }
    const statsFormatted = unsubmittedStats.map(stat => {
      return {
        id: stat.id,
        networkTxs: stat.networkTxs,
        networkTxsTotal: stat.networkTxsTotal,
        contractTypesAdded: stat.contractTypesAdded,
        contractTypesTotal: stat.contractTypesTotal,
        contractCountsByType: process.env.STATS_SUBMIT_CONTRACT_TYPES_ENABLED === 'true' ? stat.contractCountsByType : null,
        contractFieldsAdded: stat.contractFieldsAdded,
        contractFieldsTotal: stat.contractFieldsTotal,
        usersAdded: stat.usersAdded,
        usersTotal: stat.usersTotal,
        apiReads: stat.apiReads,
        apiReadsTotal: stat.apiReadsTotal,
        apiWrites: stat.apiWrites,
        apiWritesTotal: stat.apiWritesTotal,
        periodSec: stat.periodSec,
        timestamp: stat.timestamp,
      }
    })
    const jsonBody = {
      nodeId: {
        nodeHost: process.env.NODE_HOST,
        nodeAddress: this.nodeAddress,
        stratoVersion: process.env.STRATO_VERSION,
      },
      stats: statsFormatted
    }
    
    const statServerUrl = new URL(posix.join(config.statistics.blockappsStatServerApiPath, 'stats/'), config.statistics.blockappsStatServerUrl).href
    
    function postPromise () {
      return axios({
        method: 'post',
        url: statServerUrl,
        data: jsonBody,
        timeout: 5000,
      });
    }
    async function tryNTimes(toTry, count, totalCount = count, errors = []) {
      if (count > 0) {
        try {
          return await postPromise()
        } catch (e) {
          const errorText = e.message ? e.message : `${e.status}: ${e.statusText}`
          winston.warn(`Unable to reach the BlockApps Stat Server. Attempt: ${totalCount - count + 1}/${totalCount}. Error: ${errorText}`)
          await new Promise(r => setTimeout(r, 5000));
          return await tryNTimes(postPromise, count - 1, totalCount, [errorText, ...errors])
        }
      } else {
        const errorMsg = `Failed to reach BlockApps StatServer after ${totalCount} attempts`
        winston.warn(`${errorMsg}. Will retry on the next stat collect-submit iteration`)
        throw new Error(`${errorMsg}. Errors: \n ${errors.join(' \n')}`)
      }
    }
    try {
      await tryNTimes(postPromise, 3)
    } catch (e) {
      return formatResponse(false, e.message)
    }
    
    const [numOfUpdatedStats] = await models.UsageStat.update({
      submitted: true
    }, {
      where: {
        id: statsFormatted.map(stat => stat.id)
      },
      raw: true
    })
    const msg = 'The stats were successfully submitted to BlockApps StatServer'
    winston.info(msg)
    return formatResponse(true, msg)
  }
  
}

module.exports = { StatsDaemon }
