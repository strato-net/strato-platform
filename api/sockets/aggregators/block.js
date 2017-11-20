// const Block = require('../eth/block');
const sockets = require('../connect/sockets');
const {LAST_BLOCK_NUMBER} = require('../constants')

function getLastBlock() {
  // Block.findAll({raw: true}).then(blocks => {
  //   // console.log(JSON.parse( blocks[0].block_data ) )
  //   const block_data = JSON.parse( blocks[0].block_data );
  //   if(block_data.length > 0 ) {
  //     let data = {};
  //     block_data.forEach(function(value) {
  //       data[value[0]] = value[1]
  //     })
  //     console.log(data);
  //     io.in(`ROOM_${LAST_BLOCK_NUMBER}`).emit(`EVENT_${LAST_BLOCK_NUMBER}`, data.number);      
  //   }
  //  })
  console.log('IO:', sockets.io)
   sockets.io && sockets.io.in(`ROOM_${LAST_BLOCK_NUMBER}`).emit(`EVENT_${LAST_BLOCK_NUMBER}`, Math.random()*100);      
}

setTimeout(getLastBlock, 3000)