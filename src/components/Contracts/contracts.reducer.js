import {
  FETCH_CONTRACTS,
  FETCH_CONTRACTS_SUCCESS,
  FETCH_CONTRACTS_FAILURE,
} from './contracts.actions';

const initialState = {
  contracts: [],
  error: null,
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case FETCH_CONTRACTS:
      return {
        contracts: state.contracts,
        error: null,
      };
    case FETCH_CONTRACTS_SUCCESS:
      return {
        contracts: action.contracts,
        error: null,
      };
    case FETCH_CONTRACTS_FAILURE:
      return {
        contracts: state.contracts,
        error: action.error
      };
    default:
      return state;
  }
};

export default reducer;
