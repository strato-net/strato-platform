const { GET_SHARD_COUNT,} = require('../rooms');
const { emitter, ON_SOCKET_PUBLISH_EVENTS } = require('../eventBroker');
const ChainInfoRef = require('../../models/strato/eth/chainInfoRef');
const db = require('../../models/strato/eth/connection');
const config = require('../../config/app.config');

let shardCount = 0
function getShardCount() {
    return ChainInfoRef
      .count()
      .then((count) => {
        shardCount = count
        emitter.emit(ON_SOCKET_PUBLISH_EVENTS, GET_SHARD_COUNT, count)
        return
      })
}


getShardCount()
setInterval(getShardCount, config.webSockets.dbPollFrequency)

function initialHydrateShardCount(socket) {
    socket.emit(`PRELOAD_${GET_SHARD_COUNT}`, shardCount)
}

module.exports = {
    initialHydrateShardCount,
}