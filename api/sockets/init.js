const { LAST_BLOCK_NUMBER, TRANSACTIONS_COUNT, USERS_COUNT, PEERS, CONTRACTS_COUNT } = require('./rooms')
const { emitter, ON_SOCKET_PUBLISH_EVENTS } = require('./eventBroaker')
const lastBlockNumberAggregator = require('./aggregators/lastBlockNumber')

const io = require('socket.io')()
function init(server) {
  io.listen(server);
  io.on('connection', function (socket) {
    // register request to block number
    registerRoomAllocation(socket, LAST_BLOCK_NUMBER, lastBlockNumberAggregator.initialHydrate)
    // // register request to transaction count
    // registerRoomAllocation(socket, 'TRANSACTIONS_COUNT', () => {
    //   socket.emit(`PRELOAD_${'TRANSACTIONS_COUNT'}`, data);
    // })
    // // register request to users count
    // registerRoomAllocation(socket, 'USERS_COUNT', () => {
    //   socket.emit(`PRELOAD_${'USERS_COUNT'}`, data);
    // })
    // // register request to peers
    // registerRoomAllocation(socket, 'PEERS', () => {
    //   socket.emit(`PRELOAD_${'PEERS'}`, data);
    // })
    // // register request to contracts count
    // registerRoomAllocation(socket, 'CONTRACTS_COUNT', () => {
    //   socket.emit(`PRELOAD_${'CONTRACTS_COUNT'}`, data);
    // })
  });
}

emitter.on(ON_SOCKET_PUBLISH_EVENTS, function (room, data) {
  io.in(`ROOM_${room}`).emit(`EVENT_${room}`, data);
});

function registerRoomAllocation(socket, room, preloadCb) {
  socket.on(`SUBSCRIBE/${room}`, (data) => {
    socket.join(`ROOM_${room}`, () => {
      preloadCb(socket)
    })
  })
  socket.on(`UNSUBSCRIBE/${room}`, (data) => {
    socket.leave(`ROOM_${room}`)
  })
}

module.exports = {
  init
};