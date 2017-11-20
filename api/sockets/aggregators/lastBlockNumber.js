const { LAST_BLOCK_NUMBER } = require('../rooms')
const { emitter, ON_SOCKET_PUBLISH_EVENTS } = require('../eventBroaker')

let randomNumber = Math.random() * 100

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
  // actually trigger the event:
  const newRandomNumber = Math.random() * 100
  if (randomNumber !== newRandomNumber) {
    randomNumber = newRandomNumber
    emitter.emit(ON_SOCKET_PUBLISH_EVENTS, LAST_BLOCK_NUMBER, newRandomNumber)
  }

}

setInterval(getLastBlock, 3000)

function initialHydrate(socket) {
  socket.emit(`PRELOAD_${LAST_BLOCK_NUMBER}`, randomNumber);
}

module.exports = {
  initialHydrate
}