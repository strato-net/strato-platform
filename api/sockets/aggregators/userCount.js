const { USERS_COUNT } = require('../rooms')
const { emitter, ON_SOCKET_PUBLISH_EVENTS } = require('../eventBroaker')
const User = require('../models/block22/user')

let userCount

function getUserCount() {
  User.count().then(users => {
    const newUserCount = users
    if (userCount !== newUserCount) {
      userCount = newUserCount
      emitter.emit(ON_SOCKET_PUBLISH_EVENTS, USERS_COUNT, userCount)
    }
  })
}

getUserCount()
setInterval(getUserCount, 3000)

function initialHydrate(socket) {
  socket.emit(`PRELOAD_${USERS_COUNT}`, userCount);
}

module.exports = {
  initialHydrate
}