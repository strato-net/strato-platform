const { GET_SHARD_COUNT,} = require('../rooms');
const { emitter, ON_SOCKET_PUBLISH_EVENTS } = require('../eventBroker');
const config = require('../../config/app.config');

// NOTE: chain_info_ref table was removed from schema. 
// Stubbing with fixed value until proper replacement mechanism is implemented.
let shardCount = 1

function getShardCount() {
    // Currently returns fixed value since chain_info_ref table no longer exists
    emitter.emit(ON_SOCKET_PUBLISH_EVENTS, GET_SHARD_COUNT, shardCount)
    return Promise.resolve(shardCount)
}

getShardCount()
setInterval(getShardCount, config.webSockets.dbPollFrequency)

function initialHydrateShardCount(socket) {
    socket.emit(`PRELOAD_${GET_SHARD_COUNT}`, shardCount)
}

module.exports = {
    initialHydrateShardCount,
}