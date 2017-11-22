const _ = require('underscore');
const { BLOCKS_DIFFICULTY, BLOCKS_FREQUENCY, TRANSACTIONS_COUNT, BLOCKS_PROPAGATION } = require('../rooms')
const { emitter, ON_SOCKET_PUBLISH_EVENTS } = require('../eventBroaker')
const Block = require('../models/eth/block')

let difficulty
let txFrequency
let txCount
let propagationDelay

function getBlocks() {
  Block.findAll({ raw: true, limit: 15, order: [['id', 'DESC']] }).then(blocks => {

    let blockDifficulty = [];
    let blockData = [];
    let receiptTransactions = [];

    _.map(blocks, function (block) {
      const data = JSON.parse(block.block_data)
      let parsedBlock = _.object(_.map(data, _.values));

      blockData.push(parsedBlock);
      blockDifficulty.push(parsedBlock.difficulty.replace(/^s/, ""));

      receiptTransactions.push(JSON.parse(parsedBlock.receipt_transactions));
    })

    const currentDifficulty = extractDifficulty(blockDifficulty)
    if (!_.isEqual(currentDifficulty, difficulty)) {
      difficulty = currentDifficulty
      emitter.emit(ON_SOCKET_PUBLISH_EVENTS, BLOCKS_DIFFICULTY, currentDifficulty)
    }

    const currentTxnFrequency = extractTxFreq(receiptTransactions)
    if (!_.isEqual(currentTxnFrequency, txFrequency)) {
      txFrequency = currentTxnFrequency;
      emitter.emit(ON_SOCKET_PUBLISH_EVENTS, BLOCKS_FREQUENCY, currentTxnFrequency)
    }

    const currentTxnCount = extractTxCount(receiptTransactions)
    if (!_.isEqual(currentTxnCount, txCount)) {
      txCount = currentTxnCount;
      emitter.emit(ON_SOCKET_PUBLISH_EVENTS, TRANSACTIONS_COUNT, currentTxnCount)
    }

    const currentPropagationDelay = extractBlockPropogation(blockData)
    if (!_.isEqual(currentPropagationDelay, propagationDelay)) {
      propagationDelay = currentPropagationDelay;
      emitter.emit(ON_SOCKET_PUBLISH_EVENTS, BLOCKS_PROPAGATION, currentPropagationDelay)
    }

  })
}

function extractDifficulty(blockData) {
  return _.values(blockData).map(function (val, i) {
    return { x: i, y: parseInt(val) };
  })
}

function extractTxFreq(receiptTransactions) {
  return receiptTransactions.map(function (val, i) {
    return { x: i, y: val.length };
  })
}

function extractTxCount(blockData) {
  return blockData.map(val => {
    return val.length
  }).reduce((x, y) => {
    return x + y
  }, 0);
}

function extractBlockPropogation(blockData) {
  let timeData = [];
  let times = _.values(blockData).map(function (val) {
    return val.timestamp.replace(/^u/, "")
  });

  var i = 0;
  for (; i < times.length - 1; i++) {
    const a = (new Date(times[i + 1])).getSeconds()
    const b = (new Date(times[i])).getSeconds()
    let y = Math.abs(a - b)
    let obj = { x: i, y };
    timeData.push(obj);
  }
  return timeData;
}

// emitter.emit(ON_SOCKET_PUBLISH_EVENTS, CONTRACTS_COUNT, contractsCount)

getBlocks()
setInterval(getBlocks, 3000)

function initialHydrateDifficulty(socket) {
  socket.emit(`PRELOAD_${BLOCKS_DIFFICULTY}`, difficulty);
}

function initialHydrateBlockFrequency(socket) {
  socket.emit(`PRELOAD_${BLOCKS_FREQUENCY}`, txFrequency);
}

function initialHydrateTransactionCount(socket) {
  socket.emit(`PRELOAD_${TRANSACTIONS_COUNT}`, txCount);
}

function initalHydrateBlockPropagation(socket) {
  socket.emit(`PRELOAD_${BLOCKS_PROPAGATION}`, propagationDelay);
}

module.exports = {
  initialHydrateDifficulty,
  initialHydrateBlockFrequency,
  initialHydrateTransactionCount,
  initalHydrateBlockPropagation
}