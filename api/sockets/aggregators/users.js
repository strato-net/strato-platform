const Users = require('../block22/users');
const io = require('../connect/sockets');
const { USERS_COUNT } = require('../constants')

function getUsersCount() {
  Users.findAndCountAll({ raw: true }).then(users => {
    console.log("User.count", users.count);
    io.in(`ROOM_${USERS_COUNT}`).emit(`EVENT_${USERS_COUNT}`, users.count);
  })
}

setTimeout(getUsersCount, 3000)