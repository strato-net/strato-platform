const { CONTRACTS_COUNT } = require('../rooms')
const { emitter, ON_SOCKET_PUBLISH_EVENTS } = require('../eventBroker')
const AddressStateRef = require('../../models/strato/eth/addressStateRef');
const config = require('../../config/app.config');
const db = require('../../models/strato/eth/connection');

let contractsCount

const emptyCodeHash = 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'

function getContractsCount() {
  return AddressStateRef.count({ where: { code_hash: { [db.Sequelize.Op.ne]: emptyCodeHash } } }).then(result => {
    contractsCount = result
    return emitter.emit(ON_SOCKET_PUBLISH_EVENTS, CONTRACTS_COUNT, contractsCount)
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