const { GET_PEERS } = require('../rooms')
const { emitter, ON_SOCKET_PUBLISH_EVENTS } = require('../eventBroker')
const Peer = require('../../models/strato/eth/peer');
const config = require('../../config/app.config')
const _ = require('underscore');

let peers

function getPeers() {
  Peer
    .findAll({
      attributes: [
        'ip',
        'tcp_port',
        'udp_port',
        'pubkey',
      ],
      where: {
        active_state: 1
      }
    })
    .then((newPeers)=> {
      currentPeers = newPeers.reduce((obj, peer, i)=> {
        const enode = `enode://${peer.pubkey}@${peer.ip}:${peer.tcp_port}?discport=${peer.udp_port}`;
        obj[peer.ip] =  { ...peer, enode }
        return obj;
      }, {})

      if (!_.isEqual(peers, currentPeers)) {
        peers = currentPeers
        emitter.emit(ON_SOCKET_PUBLISH_EVENTS, GET_PEERS, currentPeers)
      }

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