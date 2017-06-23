export const METHOD_CALL_OPEN_MODAL = 'METHOD_CALL_OPEN_MODAL';
export const METHOD_CALL_CLOSE_MODAL = 'METHOD_CALL_CLOSE_MODAL';
export const METHOD_CALL_FETCH_ARGS = 'METHOD_CALL_FETCH_ARGS';
export const METHOD_CALL_FETCH_ARGS_SUCCESS = 'METHOD_CALL_FETCH_ARGS_SUCCESS';
export const METHOD_CALL_FETCH_ARGS_FAILURE = 'METHOD_CALL_FETCH_ARGS_FAILURE';

export const methodCallOpenModal = function(key) {
  return {
    type: METHOD_CALL_OPEN_MODAL,
    key: key
  };
}

export const methodCallCloseModal = function(key) {
  return {
    type: METHOD_CALL_CLOSE_MODAL,
    key: key
  };
}

export const methodCallFetchArgs = function(key) {
  return {
    type: METHOD_CALL_FETCH_ARGS,
    key: key
  };
}

export const methodCallFetchArgsSuccess = function(key, args) {
  return {
    type: METHOD_CALL_FETCH_ARGS,
    key: key,
    args: args
  };
}

export const methodCallFetchArgsFailure = function(key, error) {
  return {
    type: METHOD_CALL_FETCH_ARGS,
    key: key,
    error: error
  };
}
