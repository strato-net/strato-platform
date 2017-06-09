export const SELECT_CONTRACT_INSTANCE = 'SELECT_CONTRACT_INSTANCE';
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

export const fetchStateSuccess = function (name, address, state) {
  return {
    type: FETCH_STATE_SUCCESS,
    name: name,
    address: address,
    state: state,
  }
};

export const fetchStateFailure = function (error) {
  return {
    type: FETCH_STATE_FAILURE,
    error: error,
  }
};

export const selectContractInstance = function(name, address) {
  return {
    type: SELECT_CONTRACT_INSTANCE,
    name,
    address
  }
}
