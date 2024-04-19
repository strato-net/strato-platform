const {
  LAST_BLOCK_NUMBER,
  TRANSACTIONS_COUNT,
  USERS_COUNT,
  GET_PEERS,
  CONTRACTS_COUNT,
  TRANSACTIONS_TYPE,
  GET_TRANSACTIONS,
  BLOCKS_PROPAGATION,
  BLOCKS_DIFFICULTY,
  GET_COINBASE,
  GET_HEALTH,
  GET_NODE_UPTIME,
  GET_SYSTEM_INFO,
  GET_SHARD_COUNT,
  GET_NETWORK_HEALTH
} = require('./rooms')

const { emitter, ON_SOCKET_PUBLISH_EVENTS } = require('./eventBroker')
const userCountAggregator = require('./aggregators/userCount')
const contractsCountAggregator = require('./aggregators/contractsCount')
const getPeersAggregator = require('./aggregators/getPeers')
const transactionsTypeAggregator = require('./aggregators/transactionsType')
const getBlocksAggregator = require('./aggregators/getBlocks')
const getTransactionsAggregator = require('./aggregators/getTransactions');
const getCoinbaseAggregator = require('./aggregators/getCoinbase');
const getHealthAggregator = require('./aggregators/getHealthStatus');
const getShardCountAggregator = require('./aggregators/getChains');

const io = require('socket.io')()
function init(server) {
  io.listen(server, { path: '/apex-ws' });
  io.on('connection', function (socket) {
    // register request to block number
    registerRoomAllocation(socket, LAST_BLOCK_NUMBER, getBlocksAggregator.initialHydrateLastBlock)

    // register request to users count
    registerRoomAllocation(socket, USERS_COUNT, userCountAggregator.initialHydrate)

    // register request to get peers
    registerRoomAllocation(socket, GET_PEERS, getPeersAggregator.initialHydrate)

    // register request to contracts count
    registerRoomAllocation(socket, CONTRACTS_COUNT, contractsCountAggregator.initialHydrate)

    // register request for blocks data
    registerRoomAllocation(socket, BLOCKS_DIFFICULTY, getBlocksAggregator.initialHydrateDifficulty)

    // register request for blocks data
    registerRoomAllocation(socket, BLOCKS_PROPAGATION, getBlocksAggregator.initalHydrateBlockPropagation)

    // register request for transaction data
    registerRoomAllocation(socket, TRANSACTIONS_TYPE, transactionsTypeAggregator.initialHydrate)

    // register request for transaction data
    registerRoomAllocation(socket, GET_TRANSACTIONS, getTransactionsAggregator.initialHydrate)

    // register request for transaction data
    registerRoomAllocation(socket, TRANSACTIONS_COUNT, getBlocksAggregator.initialHydrateTransactionCount)

    // register request for Coinbase
    registerRoomAllocation(socket, GET_COINBASE, getCoinbaseAggregator.initialHydrate)

    // register request for node health check
    registerRoomAllocation(socket, GET_HEALTH, getHealthAggregator.initialHydrateHealthStatus)

    // register request for node uptime duration
    registerRoomAllocation(socket, GET_NODE_UPTIME, getHealthAggregator.initialHydrateUptime)

    // register request for node uptime duration
    registerRoomAllocation(socket, GET_SYSTEM_INFO, getHealthAggregator.initialHydrateSystemInfo)

    // register request for network health check
    registerRoomAllocation(socket, GET_NETWORK_HEALTH, getHealthAggregator.initialHydrateNetworkHealthInfo)

    // register request for chains count
    registerRoomAllocation(socket, GET_SHARD_COUNT, getShardCountAggregator.initialHydrateShardCount)
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
