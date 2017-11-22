const _ = require('underscore');
const { GET_PEERS } = require('../rooms')
const { emitter, ON_SOCKET_PUBLISH_EVENTS } = require('../eventBroaker')
const Peer = require('../models/eth/peer')
var rp = require('request-promise');

let peers

const options = {
  uri: 'http://localhost/strato-api/eth/v1.2/peers',
  json: true
}

function getPeers() {
  rp(options)
  .then(function (data) {
    let newPeers = data;
    if (!_.isEqual(data, newPeers)) {
      emitter.emit(ON_SOCKET_PUBLISH_EVENTS, GET_PEERS, data)
    }
  })
  .catch(function (err) {
    console.log("err", err);
  });
}

getPeers()
setInterval(getPeers, 3000)

function initialHydrate(socket) {
  socket.emit(`PRELOAD_${GET_PEERS}`, peers);
}

module.exports = {
  initialHydrate
}