const { BLOCKS_DIFFICULTY, TRANSACTIONS_COUNT, BLOCKS_PROPAGATION, LAST_BLOCK_NUMBER } = require('../rooms');
const { emitter, ON_SOCKET_PUBLISH_EVENTS } = require('../eventBroker');
const BlockDataRef = require('../../models/strato/eth/blockDataRef');
const BlockTransaction = require('../../models/strato/eth/blockTransaction');
const config = require('../../config/app.config');
const db = require('../../models/strato/eth/connection');
const moment = require('moment');
const bigInt = require('big-integer');

let difficulty = [];
let txCount = [];
let propagationDelay = [];
let lastBlockNumber = bigInt();
let globalBlocks = [];

function getBlocks() {
  BlockDataRef
    .findAll(
      {
        attributes: [
          'difficulty',
          'number',
          'timestamp',
          'id'
        ],
        where: {
          pow_verified: true,
          is_confirmed: true
        }, 
        raw: true, 
        limit: 15, 
        order: [['number', 'DESC']] 
      }
    ).then(blocks => {
      // New block. Emit some information
      if(globalBlocks.length === 0) {
        globalBlocks = blocks;         
      }

      if(blocks.length > 0 && lastBlockNumber.compare(bigInt(blocks[0].number)) < 0) {
        lastBlockNumber = bigInt(blocks[0].number);

        let blockDifficulty = []
        let blockPropagation = []
        let blockIds = [];

        // reverse the blocks (so the graphs are L2R instead of R2L)
        for(var i = blocks.length-1; i >=0 ; i--) {
          
          let rIndex = blocks.length - i - 1 //do not use this as an index
          let block = blocks[i]

          blockDifficulty.push({
            x: rIndex,
            // aaargh!!! Just doing this.. but need a better way to handle BigInts
            y: parseInt(block.difficulty)
          })

          let propagation = rIndex === 0 ? calculatePropagation(null, block) : calculatePropagation(blocks[i+1], block)
          blockPropagation.push({
            x: rIndex,
            y: propagation
          })

          blockIds.push(block.id)
          
        }

        emitter.emit(ON_SOCKET_PUBLISH_EVENTS, LAST_BLOCK_NUMBER, lastBlockNumber.toString())
      
        difficulty = blockDifficulty
        emitter.emit(ON_SOCKET_PUBLISH_EVENTS, BLOCKS_DIFFICULTY, difficulty)        

        propagationDelay = blockPropagation
        emitter.emit(ON_SOCKET_PUBLISH_EVENTS, BLOCKS_PROPAGATION, propagationDelay)

        getBlockTransactionCount(blockIds)
          .then(() => {
            globalBlocks = blocks
          });
      }
      
    })
}

function getBlockTransactionCount(blockIds) {
  return BlockTransaction
    .findAll({
      attributes: [
        'block_data_ref_id',
        [
          db.sequelize.fn('COUNT', db.sequelize.col('transaction')), 'txCount'
        ],
      ],
      where: {
        block_data_ref_id: {
          [db.Sequelize.Op.in]: blockIds
        }
      },
      group: ['block_data_ref_id'],
      order: [['block_data_ref_id', 'ASC']]
    })
    .then((counts) => {
      txCountMap = counts.reduce((map, count)=>{
        map[count.block_data_ref_id] = parseInt(count.get('txCount'));
        return map;
      }, {})
      txCount = blockIds.map((blockId, i)=>{
        return {
          x: i,
          y: txCountMap[blockId] || 0
        }
      })
      emitter.emit(ON_SOCKET_PUBLISH_EVENTS, TRANSACTIONS_COUNT, txCount)
      return
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

