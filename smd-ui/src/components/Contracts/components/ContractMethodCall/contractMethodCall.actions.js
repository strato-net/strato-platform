export const METHOD_CALL_OPEN_MODAL = 'METHOD_CALL_OPEN_MODAL';
export const METHOD_CALL_CLOSE_MODAL = 'METHOD_CALL_CLOSE_MODAL';
export const METHOD_CALL_FETCH_ARGS_REQUEST = 'METHOD_CALL_FETCH_ARGS_REQUEST';
export const METHOD_CALL_FETCH_ARGS_SUCCESS = 'METHOD_CALL_FETCH_ARGS_SUCCESS';
export const METHOD_CALL_FETCH_ARGS_FAILURE = 'METHOD_CALL_FETCH_ARGS_FAILURE';
export const METHOD_CALL_REQUEST = 'METHOD_CALL_REQUEST';
export const METHOD_CALL_SUCCESS = 'METHOD_CALL_SUCCESS';
export const METHOD_CALL_FAILURE = 'METHOD_CALL_FAILURE';

export const methodCallOpenModal = function (key) {
  return {
    type: METHOD_CALL_OPEN_MODAL,
    key: key
  };
}

export const methodCallCloseModal = function (key) {
  return {
    type: METHOD_CALL_CLOSE_MODAL,
    key: key
  };
}

export const methodCallFetchArgs = function (name, address, symbol, key, chainId) {
  return {
    type: METHOD_CALL_FETCH_ARGS_REQUEST,
    name: name,
    address: address,
    symbol: symbol,
    key: key,
    chainId: chainId
  };
}

export const methodCallFetchArgsSuccess = function (key, args) {
  return {
    type: METHOD_CALL_FETCH_ARGS_SUCCESS,
    key: key,
    args: args
  };
}

export const methodCallFetchArgsFailure = function (key, error) {
  return {
    type: METHOD_CALL_FETCH_ARGS_FAILURE,
    key: key,
    error: error
  };
}

export const methodCall = function (key, payload) {
  return {
    type: METHOD_CALL_REQUEST,
    payload: payload,
    key: key
  };
}

export const methodCallSuccess = function (key, result) {
  return {
    type: METHOD_CALL_SUCCESS,
    key: key,
    result: result
  };
}

export const methodCallFailure = function (key, error) {
  return {
    type: METHOD_CALL_FAILURE,
    key: key,
    result: error
  };
}
