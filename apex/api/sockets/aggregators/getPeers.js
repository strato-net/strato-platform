const { GET_PEERS } = require('../rooms')
const { emitter, ON_SOCKET_PUBLISH_EVENTS } = require('../eventBroker')
const Peer = require('../../models/strato/eth/peer');
const config = require('../../config/app.config')
const _ = require('underscore');
const winston = require('winston-color');

let peers

function getPeers() {
  Peer
    .findAll({
      attributes: [
        'host',
        'ip',
        'tcp_port',
        'pubkey',
      ],
      where: {
        active_state: 1
      }
    })
    .then((newPeers)=> {
      currentPeers = newPeers.reduce((obj, peer, i)=> {
        obj[peer.ip] = peer
        return obj;
      }, {})

      if (!_.isEqual(peers, currentPeers)) {
        peers = currentPeers
        emitter.emit(ON_SOCKET_PUBLISH_EVENTS, GET_PEERS, currentPeers)
      }

    })
    .catch((err) => {
      if (err.original && err.original.code === '42P01') return;
      winston.warn(`Could not fetch peers, retrying next poll: ${err.message}`);
    })
}

getPeers()
setInterval(getPeers, config.webSockets.dbPollFrequency)

function initialHydrate(socket) {
  socket.emit(`PRELOAD_${GET_PEERS}`, peers);
}

module.exports = {
  initialHydrate
}
