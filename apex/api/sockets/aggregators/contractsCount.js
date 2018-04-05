const { CONTRACTS_COUNT } = require('../rooms')
const { emitter, ON_SOCKET_PUBLISH_EVENTS } = require('../eventBroker')
const ContractInstance = require('../../models/strato/bloc22/contractsInstance');
const config = require('../../config/app.config')

let contractsCount

function getContractsCount() {
  ContractInstance.count().then(contracts => {
    const newContractsCount = contracts
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