export const FETCH_TX = 'FETCH_TX';
export const FETCH_TX_SUCCESSFUL = 'FETCH_TX_SUCCESSFUL';
export const FETCH_TX_FAILED = 'FETCH_TX_FAILED';
export const UPDATE_TX = 'UPDATE_TX';
export const PRELOAD_TX = 'PRELOAD_TX';

export const updateTx = function (data) {
  return {
    type: UPDATE_TX,
    data
  }
}

export const preloadTx = function (data) {
  return {
    type: PRELOAD_TX,
    data
  }
}

export const fetchTx = function (last, chainId) {
  return {
    type: FETCH_TX,
    last: last,
    chainId: chainId
  }
};

export const fetchTxSuccess = function (res) {
  return {
    type: FETCH_TX_SUCCESSFUL,
    tx: res
  }
};

export const fetchTxFailure = function (error) {
  return {
    type: FETCH_TX_FAILED,
    error: error,
  }
};
