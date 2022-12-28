const { USERS_COUNT } = require('../rooms')
const { emitter, ON_SOCKET_PUBLISH_EVENTS } = require('../eventBroker')
const Transaction = require ('../../models/strato/eth/transaction');
const config = require('../../config/app.config')

let userCount

function getUserCount() {
  // TODO: replace with query for the count of registered Certs
  Transaction.count(
      {
        distinct: 'to_address', 
        where: {
          from_address: 'e1fd0d4a52b75a694de8b55528ad48e2e2cf7859', // faucet account from default genesis block // TODO: make it obtained dynamically?
          origin: 'API',
        }
      }
  ).then(newUserCount => {
    if (userCount !== newUserCount) {
      userCount = newUserCount
      emitter.emit(ON_SOCKET_PUBLISH_EVENTS, USERS_COUNT, userCount)
    }
  })
}

getUserCount()
setInterval(getUserCount, config.webSockets.dbPollFrequency)

function initialHydrate(socket) {
  socket.emit(`PRELOAD_${USERS_COUNT}`, userCount);
}

module.exports = {
  initialHydrate
}
