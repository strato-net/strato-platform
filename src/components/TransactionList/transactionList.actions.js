export const FETCH_TX = 'FETCH_TX';
export const FETCH_TX_SUCCESS = 'FETCH_TX_SUCCESS';
export const FETCH_TX_FAILURE = 'FETCH_TX_FAILURE';

export const fetchTx = function (last) {
  return {
    type: FETCH_TX,
    last: last,
  }
};

export const fetchTxSuccess = function (res) {
  return {
    type: FETCH_TX_SUCCESS,
    tx: res
  }
};

export const fetchTxFailure = function (error) {
  return {
    type: FETCH_TX_FAILURE,
    error: error,
  }
};
