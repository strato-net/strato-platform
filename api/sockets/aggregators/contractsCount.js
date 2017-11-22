const { CONTRACTS_COUNT } = require('../rooms')
const { emitter, ON_SOCKET_PUBLISH_EVENTS } = require('../eventBroaker')
const Contract = require('../models/block22/contract')

let contractsCount

function getContractsCount() {
  Contract.count().then(contracts => {
    const newContractsCount = contracts
    if (contractsCount !== newContractsCount) {
      contractsCount = newContractsCount
      emitter.emit(ON_SOCKET_PUBLISH_EVENTS, CONTRACTS_COUNT, contractsCount)
    }
  })
}

getContractsCount()
setInterval(getContractsCount, 3000)

function initialHydrate(socket) {
  socket.emit(`PRELOAD_${CONTRACTS_COUNT}`, contractsCount);
}

module.exports = {
  initialHydrate
}