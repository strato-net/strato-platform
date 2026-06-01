const { GET_COINBASE } = require('../rooms')

let coinbase

// DISABLED: the strato-api `/coinbase` endpoint was removed, so this
// aggregator can no longer fetch the node address from strato. The node
// address is now surfaced via apex's /status and /health endpoints
// (sourced from the `pbft_node_identity` Prometheus metric). The socket
// room/hydrate wiring is left intact so existing subscribers don't break;
// `coinbase` simply stays undefined.
//
// function getCoinbase() { ... } // removed: called dead `${stratoRoot}/coinbase`
// getCoinbase()


function initialHydrate(socket) {
  socket.emit(`PRELOAD_${GET_COINBASE}`, coinbase);
}

module.exports = {
  initialHydrate
}