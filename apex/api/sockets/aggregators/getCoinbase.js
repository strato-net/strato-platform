const _ = require('underscore');
const { GET_COINBASE } = require('../rooms')
const { emitter, ON_SOCKET_PUBLISH_EVENTS } = require('../eventBroker')
var rp = require('request-promise');

let coinbase

const options = {
  uri: `${process.env['stratoRoot']}/coinbase`,
  json: true
}

function getCoinbase() {
  rp(options)
    .then(function (currentCoinbase) {
      if (!_.isEqual(coinbase, currentCoinbase)) {
        console.log("currentCoinbase", currentCoinbase);
        coinbase = currentCoinbase
        emitter.emit(ON_SOCKET_PUBLISH_EVENTS, GET_COINBASE, currentCoinbase)
      }
    })
    .catch(function (err) {
      console.error("Error: ", err);
      throw err
    });
}

getCoinbase()
// coinbase shouldnt (or cant as of now) change without restarting strato
// No need to poll for this right now.
// setInterval(getCoinbase, 3000)


function initialHydrate(socket) {
  socket.emit(`PRELOAD_${GET_COINBASE}`, coinbase);
}

module.exports = {
  initialHydrate
}