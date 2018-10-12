const { CONTRACTS_COUNT } = require('../rooms')
const { emitter, ON_SOCKET_PUBLISH_EVENTS } = require('../eventBroker')
const Contract = require('../../models/strato/bloc22/contract');
const config = require('../../config/app.config');
const db = require('../../models/strato/eth/connection');

let contractsCount

function getContractsCount() {
  // NOTE: ID greater than 2 is uesd because AppMetadata and owned contracts are first 2 rows. which is not uploaded by user 
  Contract.count({ where: { id: { [db.Sequelize.Op.gt]: 2 } } }).then(contracts => {
    const newContractsCount = contracts;
    if (contractsCount !== newContractsCount) {
      contractsCount = newContractsCount
      emitter.emit(ON_SOCKET_PUBLISH_EVENTS, CONTRACTS_COUNT, contractsCount)
    }
  })
}

getContractsCount()
setInterval(getContractsCount, config.webSockets.dbPollFrequency)

function initialHydrate(socket) {
  socket.emit(`PRELOAD_${CONTRACTS_COUNT}`, contractsCount);
}

module.exports = {
  initialHydrate
}