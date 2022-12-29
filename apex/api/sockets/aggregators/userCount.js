const { USERS_COUNT } = require('../rooms')
const { emitter, ON_SOCKET_PUBLISH_EVENTS } = require('../eventBroker')
const Transaction = require ('../../models/strato/eth/transaction');
const config = require('../../config/app.config')
const db = require("../../models/strato/eth/connection");

let userCount

function getUserCount() {
  // TODO: replace with query to count the registered user certificates
  // Temporary counting users who posted at least one transaction:
  Transaction.count(
      {
        distinct: true,
        col: 'from_address', 
        where: {
          origin: { [db.Sequelize.Op.eq]: 'API' },
          from_address: { [db.Sequelize.Op.ne]: '0000000000000000000000000000000000000000' },
        }
      }
  ).then(count => {
    const newUserCount = (count >= 1) ? count - 1 : count  // Excluding the faucet account address coming from a genesis block
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
