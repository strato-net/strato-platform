const _ = require('underscore');
const { BLOCKS_DIFFICULTY, BLOCKS_FREQUENCY, TRANSACTIONS_COUNT, BLOCKS_PROPOGATION } = require('../rooms')
const { emitter, ON_SOCKET_PUBLISH_EVENTS } = require('../eventBroaker')
const Block = require('../models/eth/block')

let block_difficulty = [];
let block_data = [];
let receipt_transactions = [];

let newDifficulty
let newFreq
let newTxCount
let newProgpagation

function getBlocks() {
  Block.findAll({raw: true, limit: 15, order: [['id', 'DESC']]}).then(blocks => {
    
    let blockDifficulty = [];
    let blockData = [];
    let receiptTransactions = [];
    
    _.map(blocks, function (block) {
      const data = JSON.parse(block.block_data)
      let block_data = _.object(_.map(data, _.values));
      
      blockData.push(block_data);
      blockDifficulty.push(block_data.difficulty.replace(/^s/, ""));

      receiptTransactions.push(JSON.parse(block.receipt_transactions));
    })
    
    block_difficulty = blockDifficulty
    block_data = blockData
    receipt_transactions = receiptTransactions

    const oldDifficulty = difficulty(blockDifficulty)
    if (!_.isEqual(oldDifficulty, newDifficulty)) {
      newDifficulty = oldDifficulty
      emitter.emit(ON_SOCKET_PUBLISH_EVENTS, BLOCKS_DIFFICULTY, oldDifficulty)
    }

    const freq = txFreq(receiptTransactions)
    if (!_.isEqual(freq, newFreq)) {
      newFreq = freq;
      emitter.emit(ON_SOCKET_PUBLISH_EVENTS, BLOCKS_FREQUENCY, freq)
    }

    const txn = txCount(receiptTransactions)
    if (!_.isEqual(txn, newTxCount)) {
      newTxCount = txn;
      emitter.emit(ON_SOCKET_PUBLISH_EVENTS, TRANSACTIONS_COUNT, txn)
    }

    const blockProp = blockPropogation(blockData)
    if (!_.isEqual(blockProp, newProgpagation)) {
      newProgpagation = blockProp;
      emitter.emit(ON_SOCKET_PUBLISH_EVENTS, BLOCKS_PROPOGATION, blockProp)
    }

  })
}

function difficulty(blockData) {
  return _.values(blockData).map(function (val, i) {
    return { x: i, y: val };
  })
}

function txFreq(receiptTransactions) {
  return receiptTransactions.map(function (val, i) {
    return { x: i, y: val.length };
  })
}

function txCount(blockData) {
  return blockData.map(val => {
    return val.length
  }).reduce((x, y) => {
    return x + y
  }, 0);
}

function blockPropogation(blockData) {
  let timeData = [];
  let times = _.values(blockData).map(function (val) {
    return val.timestamp.replace(/^u/, "")
  });

  var i = 0;
  for (; i < times.length - 1; i++) {
    const a = (new Date(times[i + 1])).getSeconds()
    const b = (new Date(times[i])).getSeconds()
    let y = Math.abs( a - b)
    let obj = { x: i, y };
    timeData.push(obj);
  }
  return timeData;
}

// emitter.emit(ON_SOCKET_PUBLISH_EVENTS, CONTRACTS_COUNT, contractsCount)

getBlocks()
setInterval(getBlocks, 3000)

function initialHydrateDifficulty(socket) {
  socket.emit(`PRELOAD_${BLOCKS_DIFFICULTY}`, difficulty(block_difficulty));
}

function initialHydrateBlockFrequency(socket) {
  socket.emit(`PRELOAD_${BLOCKS_FREQUENCY}`, txFreq(receipt_transactions));
}

function initialHydrateTransactionCount(socket) {
  socket.emit(`PRELOAD_${TRANSACTIONS_COUNT}`, txCount(receipt_transactions));  
}

function initalHydrateBlockPropagation(socket) {
  socket.emit(`PRELOAD_${BLOCKS_PROPOGATION}`, blockPropogation(block_data));  
}

module.exports = {
  initialHydrateDifficulty,
  initialHydrateBlockFrequency,
  initialHydrateTransactionCount,
  initalHydrateBlockPropagation
}