const { USERS_COUNT } = require('../rooms')
const { emitter, ON_SOCKET_PUBLISH_EVENTS } = require('../eventBroker')
const User = require('../../models/strato/oauth/user');
const config = require('../../config/app.config')

let userCount

function getUserCount() {
  User.count().then(users => {
    const newUserCount = users - 1;
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