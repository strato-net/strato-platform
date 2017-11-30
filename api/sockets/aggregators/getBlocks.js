const { BLOCKS_DIFFICULTY, TRANSACTIONS_COUNT, BLOCKS_PROPAGATION, LAST_BLOCK_NUMBER } = require('../rooms')
const { emitter, ON_SOCKET_PUBLISH_EVENTS } = require('../eventBroker')
const BlockDataRef = require('../models/eth/blockDataRef')
const BlockTransaction = require('../models/eth/blockTransaction')
const config = require('../../config/app.config')
const db = require('../models/eth/connection')
const moment = require('moment')
const bigInt = require('big-integer');

let difficulty = []
let txCount = []
let propagationDelay = []
let lastBlockNumber = bigInt()
let globalBlocks = []

function getBlocks() {
  BlockDataRef
    .findAll(
      {
        attributes: [
          'difficulty',
          'number',
          'timestamp',
          'block_id'
        ],
        where: {
          pow_verified: true,
          is_confirmed: true
        }, 
        raw: true, 
        limit: 15, 
        order: [['number', 'ASC']] 
      }
    ).then(blocks => {
      // New block. Emit some information
      globalBlocks = blocks; 
      if(blocks.length > 0 && lastBlockNumber.compare(bigInt(blocks[blocks.length-1].number)) < 0) {
        lastBlockNumber = bigInt(blocks[blocks.length-1].number);

        let blockDifficulty = []
        let blockPropagation = []
        let blockIds = [];

        blocks.forEach((block, i) => {
          // aaargh!!! Just doing this.. but need a better way to handle BigInts
          blockDifficulty.push({
            x: i,
            y: parseInt(block.difficulty)
          })

          let propagation = i === 0 ? calculatePropagation(null, block) : calculatePropagation(blocks[i-1], block)
          blockPropagation.push({
            x: i,
            y: propagation
          })

          blockIds.push(block.block_id)

        })
        emitter.emit(ON_SOCKET_PUBLISH_EVENTS, LAST_BLOCK_NUMBER, lastBlockNumber.toString())
      
        difficulty = blockDifficulty
        emitter.emit(ON_SOCKET_PUBLISH_EVENTS, BLOCKS_DIFFICULTY, difficulty)        

        propagationDelay = blockPropagation
        emitter.emit(ON_SOCKET_PUBLISH_EVENTS, BLOCKS_PROPAGATION, propagationDelay)

        getBlockTransactionCount(blockIds);
      }
      
    })
}

function getBlockTransactionCount(blockIds) {
  BlockTransaction
    .findAll({
      attributes: [
        'block_id',
        [
          db.sequelize.fn('COUNT', db.sequelize.col('transaction')), 'txCount'
        ],
      ],
      where: {
        block_id: {
          [db.Sequelize.Op.in]: blockIds
        }
      },
      group: ['block_id'],
      order: [['block_id', 'ASC']] 
    })
    .then((counts) => {
      txCountMap = counts.reduce((map, count)=>{
        map[count.block_id] = parseInt(count.get('txCount'));
        return map;
      }, {})
      txCount = blockIds.map((blockId, i)=>{
        return {
          x: i,
          y: txCountMap[blockId] || 0
        }
      })
      emitter.emit(ON_SOCKET_PUBLISH_EVENTS, TRANSACTIONS_COUNT, txCount)
    })
}

function calculatePropagation(prevBlock, currentBlock) {
  let previous = prevBlock
  
  if(previous == null) {
    //look in globalBlocks for prevBlock  
    const filtered = globalBlocks.filter((block)=> {
      return block.number === currentBlock.number - 1
    })
    if(filtered.length === 0) {
      return 0
    }  
    previous = filtered[0]
  }

  return moment(currentBlock.timestamp).diff(moment(previous.timestamp),'seconds')
  
}


getBlocks()
setInterval(getBlocks, config.webSockets.dbPollFrequency)

function initialHydrateDifficulty(socket) {
  socket.emit(`PRELOAD_${BLOCKS_DIFFICULTY}`, difficulty)
}

function initialHydrateTransactionCount(socket) {
  socket.emit(`PRELOAD_${TRANSACTIONS_COUNT}`, txCount)
}

function initalHydrateBlockPropagation(socket) {
  socket.emit(`PRELOAD_${BLOCKS_PROPAGATION}`, propagationDelay)
}

function initialHydrateLastBlock(socket) {
  socket.emit(`PRELOAD_${LAST_BLOCK_NUMBER}`, lastBlockNumber);
}

module.exports = {
  initialHydrateDifficulty,
  initialHydrateLastBlock,
  initialHydrateTransactionCount,
  initalHydrateBlockPropagation
}

