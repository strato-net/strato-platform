export const PRELOAD_PEERS = 'PRELOAD_PEERS';
export const UPDATE_PEERS = 'UPDATE_PEERS';
export const PRELOAD_COINBASE = 'PRELOAD_COINBASE';
export const UPDATE_COINBASE = 'UPDATE_COINBASE';

export const preloadPeers = function (peers) {
  return {
    type: PRELOAD_PEERS,
    peers: peers
  }
};

export const updatePeers = function (peers) {
  return {
    type: UPDATE_PEERS,
    peers: peers
  }
};

export const preloadCoinbase = function (coinbase) {
  return {
    type: PRELOAD_COINBASE,
    coinbase: coinbase
  }
};

export const updateCoinbase = function (coinbase) {
  return {
    type: UPDATE_COINBASE,
    coinbase: coinbase
  }
};

