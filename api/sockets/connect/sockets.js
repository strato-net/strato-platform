// const { LAST_BLOCK_NUMBER, TRANSACTIONS_COUNT, USERS_COUNT, PEERS, CONTRACTS_COUNT } = '../constants'
const constants = '../constants'
var socketIO = require('socket.io')

var sockets = {};
var allClients = [];
var io
function init(server) {
  io = socketIO.listen(server);  
  io.on('connection', function (socket) {
    console.log('Connect:', socket.id, 'LAST_BLOCK_NUMBER')
    // register request to block number
    handleRoomAllocation(socket, 'LAST_BLOCK_NUMBER', () => {
      socket.emit(`PRELOAD_${'LAST_BLOCK_NUMBER'}`, data);
    })
    // register request to transaction count
    handleRoomAllocation(socket, 'TRANSACTIONS_COUNT', () => {
      socket.emit(`PRELOAD_${'TRANSACTIONS_COUNT'}`, data);
    })
    // register request to users count
    handleRoomAllocation(socket, 'USERS_COUNT', () => {
      socket.emit(`PRELOAD_${'USERS_COUNT'}`, data);
    })
    // register request to peers
    handleRoomAllocation(socket, 'PEERS', () => {
      socket.emit(`PRELOAD_${'PEERS'}`, data);
    })
    // register request to contracts count
    handleRoomAllocation(socket, 'CONTRACTS_COUNT', () => {
      socket.emit(`PRELOAD_${'CONTRACTS_COUNT'}`, data);
    })
  });
}

function handleRoomAllocation(socket, room, preloadCb) {
  console.log('Socket:', room)
  socket.on(`SUBSCRIBE/${room}`, (data) => {
    console.log('Socket:', `SUBSCRIBE/${room}`)    
    socket.join(`ROOM_${room}`, preloadCb)
  })
  socket.on(`UNSUBSCRIBE/${room}`, (data) => {
    socket.leave(`ROOM_${room}`)
  })
}

module.exports = {
  init,
  io: io
};