const { USERS_COUNT } = require('../rooms')
const { emitter, ON_SOCKET_PUBLISH_EVENTS } = require('../eventBroker')
const Transaction = require ('../../models/strato/eth/transaction');
const config = require('../../config/app.config')

let userCount

function getUserCount() {
  // TODO: replace with query for the count of registered Certs
  // Temporary counting users who posted at least one transaction:
  Transaction.count(
      {
        distinct: 'from_address', 
        where: {
          origin: 'API',
        }
      }
  ).then(count => {
    const newUserCount = count - 2  // Excluding the faucet account from genesis block and '0000000000000000000000000000000000000000'
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
