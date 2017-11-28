const { LAST_BLOCK_NUMBER } = require('../rooms')
const { emitter, ON_SOCKET_PUBLISH_EVENTS } = require('../eventBroaker')
const Block = require('../models/eth/block')

let blockNumber

function getLastBlock() {
  Block.findOne({order: [['id', 'DESC']]}).then(block => {
    const newBlockNumber = block.id
    if (blockNumber !== newBlockNumber) {
      blockNumber = newBlockNumber
      emitter.emit(ON_SOCKET_PUBLISH_EVENTS, LAST_BLOCK_NUMBER, newBlockNumber)
    }
  })
}

getLastBlock()
setInterval(getLastBlock, 3000)

function initialHydrate(socket) {
  socket.emit(`PRELOAD_${LAST_BLOCK_NUMBER}`, blockNumber);
}

module.exports = {
  initialHydrate
}