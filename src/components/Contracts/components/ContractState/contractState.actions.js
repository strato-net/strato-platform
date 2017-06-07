export const FETCH_STATE = 'FETCH_STATE';
export const FETCH_STATE_SUCCESS = 'FETCH_STATE_SUCCESS';
export const FETCH_STATE_FAILURE = 'FETCH_STATE_FAILURE';

export const fetchState = function (name, address) {
  return {
    type: FETCH_STATE,
    name: name,
    address: address,
  }
};

export const fetchStateSuccess = function (address, state) {
  return {
    type: FETCH_STATE_SUCCESS,
    state: state,
    address: address,
  }
};

export const fetchStateFailure = function (error) {
  return {
    type: FETCH_STATE_FAILURE,
    error: error,
  }
};
