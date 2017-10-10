export const FETCH_TX = 'FETCH_TX';
export const FETCH_TX_SUCCESSFUL = 'FETCH_TX_SUCCESSFUL';
export const FETCH_TX_FAILED = 'FETCH_TX_FAILED';

export const fetchTx = function (last) {
  return {
    type: FETCH_TX,
    last: last,
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
