/* Unused code notice. Api counter disabled, to be deprecated  #api-counter-deprecation

const winston = require('winston-color');

const config = require('../config/app.config');
const models = require('../models');


class ApiCallCounter {
  
  constructor() {
    this.resetCounters()
  }
  
  resetCounters() {
    this.reads = 0
    this.writes = 0
  }

  incrementReads() {
    this.reads += 1
  }

  incrementWrites() {
    this.writes += 1
  }

  async saveToDbAndReset() {
    // We could use the Redis as external mem cache but we have plans to get rid of it soonish
    const dbData = await models.ApiCallCount.findOne({
      order: [['createdAt', 'DESC']],
    })
    await models.ApiCallCount.create({
      apiReads: this.reads,
      apiReadsTotal: dbData ? (dbData.apiReadsTotal + this.reads) : this.reads,
      apiWrites: this.writes,
      apiWritesTotal: dbData ? (dbData.apiWritesTotal + this.writes) : this.writes,
    });
    this.resetCounters()
    winston.info('Api call counters were saved to db and reset')
  }

  // Uncomment if needed (e.g. for get stats endpoint or smth), otherwise reading from db where needed.
  // // Could be static until "fix me" is fixed but 'static' is not supported by nodejs 8.15 currently used as Apex base image, implemented in EcmaScript 6
  // async getTotalCountsFromDb() {
  //   const [dbData] = await models.ApiCallCount.findOne({
  //     order: [['createdAt', 'DESC']],
  //   })
  //   // to_do: find the way to maintain the singleton ApiCallCounter object among the expressjs and the daemon nodejs processes to fetch reads and writes from object
  //   // return {
  //   //   reads: this.reads + (dbData ? dbData.apiReadsTotal : 0),
  //   //   writes: this.writes + (dbData ? dbData.apiWritesTotal : 0),
  //   //   timestamp: new Date.now()
  //   // }
  //   return {
  //     reads: dbData ? dbData.apiReadsTotal : 0,
  //     writes: dbData ? dbData.apiWritesTotal : 0,
  //     timestamp: new Date.now()
  //   }
  // }
}

const counter = new ApiCallCounter();

(async () => {
  if (process.env.STATS_ENABLED === "true") {
    setInterval(async () => {
      await counter.saveToDbAndReset()
    }, config.statistics.apiCallCounterDbSaveTimer);
  }
})();


async function apiCounterRouteController(req, res) {
  res.status(200).send();
  if (
      process.env['STATS_ENABLED'] === "true" &&
      !['OPTIONS', 'TRACE', 'HEAD', 'CONNECT'].includes(req.headers['x-original-method'])
  ) {
    if (req.headers['x-original-method'] === 'GET') {
      counter.incrementReads()
    } else if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.headers['x-original-method'])) {
      counter.incrementWrites()
    } else {
      winston.warn(`Unknown HTTP method called: ${req.headers['x-original-method']}`)
    }
  }
}

module.exports = {
  ApiCallCounter,
  apiCounterRouteController,
  counter
};
*/
