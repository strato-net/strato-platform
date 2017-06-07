export const FETCH_NODE_DETAIL = 'FETCH_NODE_DETAIL';
export const FETCH_NODE_DETAIL_SUCCESS = 'FETCH_NODE_DETAIL_SUCCESS';
export const FETCH_NODE_DETAIL_FAILURE = 'FETCH_NODE_DETAIL_FAILURE';
export const FETCH_NODE_PEERS = 'FETCH_NODE_PEERS';
export const FETCH_NODE_PEERS_SUCCESS = 'FETCH_NODE_PEERS_SUCCESS';
export const FETCH_NODE_PEERS_FAILURE = 'FETCH_NODE_PEERS_FAILURE';
export const FETCH_NODE_COINBASE = 'FETCH_NODE_COINBASE';
export const FETCH_NODE_COINBASE_SUCCESS = 'FETCH_NODE_COINBASE_SUCCESS';
export const FETCH_NODE_COINBASE_FAILURE = 'FETCH_NODE_COINBASE_FAILURE';


export const fetchNodeDetail = function(nodeIndex){
  return {
    type: FETCH_NODE_DETAIL,
    nodeIndex: nodeIndex
  }
};

export const fetchNodeDetailSuccess = function(nodeIndex, detail) {
  return {
    type: FETCH_NODE_DETAIL_SUCCESS,
    nodeIndex: nodeIndex,
    detail: detail
  }
};

export const fetchNodeDetailFailure = function(nodeIndex, error) {
  return {
    type: FETCH_NODE_DETAIL_FAILURE,
    nodeIndex: nodeIndex,
    error: error
  }
};

export const fetchNodePeers = function(nodeIndex) {
  return {
    type: FETCH_NODE_PEERS,
    nodeIndex: nodeIndex
  }
};

export const fetchNodePeersSuccess = function(nodeIndex, peers) {
  return {
    type: FETCH_NODE_PEERS_SUCCESS,
    nodeIndex: nodeIndex,
    peers: peers
  }
};

export const fetchNodePeersFailure = function(nodeIndex, error) {
  return {
    type: FETCH_NODE_PEERS_FAILURE,
    nodeIndex: nodeIndex,
    error: error
  }
};

export const fetchNodeCoinbase = function(nodeIndex) {
  return {
    type: FETCH_NODE_COINBASE,
    nodeIndex: nodeIndex
  }
};

export const fetchNodeCoinbaseSuccess = function(nodeIndex, coinbase) {
  return {
    type: FETCH_NODE_COINBASE_SUCCESS,
    nodeIndex: nodeIndex,
    coinbase: coinbase
  }
};

export const fetchNodeCoinbaseFailure = function(nodeIndex, error) {
  return {
    type: FETCH_NODE_COINBASE_FAILURE,
    nodeIndex: nodeIndex,
    error: error
  }
};
