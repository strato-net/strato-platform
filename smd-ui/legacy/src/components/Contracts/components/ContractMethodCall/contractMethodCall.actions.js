export const METHOD_CALL_REQUEST = 'METHOD_CALL_REQUEST';
export const METHOD_CALL_SUCCESS = 'METHOD_CALL_SUCCESS';
export const METHOD_CALL_FAILURE = 'METHOD_CALL_FAILURE';

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
