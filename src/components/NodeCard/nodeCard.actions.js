export const FETCH_NODE_DETAIL_REQUEST = 'FETCH_NODE_DETAIL_REQUEST';
export const FETCH_NODE_DETAIL_SUCCESS = 'FETCH_NODE_DETAIL_SUCCESS';
export const FETCH_NODE_DETAIL_FAILURE = 'FETCH_NODE_DETAIL_FAILURE';
export const FETCH_NODE_PEERS = 'FETCH_NODE_PEERS';
export const FETCH_NODE_PEERS_SUCCESSFUL = 'FETCH_NODE_PEERS_SUCCESSFUL';
export const FETCH_NODE_PEERS_FAILED = 'FETCH_NODE_PEERS_FAILED';
export const FETCH_NODE_COINBASE = 'FETCH_NODE_COINBASE';
export const FETCH_NODE_COINBASE_SUCCESSFUL = 'FETCH_NODE_COINBASE_SUCCESSFUL';
export const FETCH_NODE_COINBASE_FAILED = 'FETCH_NODE_COINBASE_FAILED';


export const fetchNodeDetail = function(nodeIndex){
  return {
    type: FETCH_NODE_DETAIL_REQUEST,
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
    type: FETCH_NODE_PEERS_SUCCESSFUL,
    nodeIndex: nodeIndex,
    peers: peers
  }
};

export const fetchNodePeersFailure = function(nodeIndex, error) {
  return {
    type: FETCH_NODE_PEERS_FAILED,
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
    type: FETCH_NODE_COINBASE_SUCCESSFUL,
    nodeIndex: nodeIndex,
    coinbase: coinbase
  }
};

export const fetchNodeCoinbaseFailure = function(nodeIndex, error) {
  return {
    type: FETCH_NODE_COINBASE_FAILED,
    nodeIndex: nodeIndex,
    error: error
  }
};
