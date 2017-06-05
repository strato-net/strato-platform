import {
  FETCH_CONTRACTS,
  FETCH_CONTRACTS_SUCCESS,
  FETCH_CONTRACTS_FAILURE,
  CHANGE_CONTRACT_FILTER,
} from './contracts.actions';

const initialState = {
  contracts: [],
  filter: '',
  error: null,
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case FETCH_CONTRACTS:
      return {
        contracts: state.contracts,
        filter: state.filter,
        error: null,
      };
    case FETCH_CONTRACTS_SUCCESS:
      return {
        contracts: action.contracts,
        filter: state.filter,
        error: null,
      };
    case FETCH_CONTRACTS_FAILURE:
      return {
        contracts: state.contracts,
        filter: state.filter,
        error: action.error
      };
    case CHANGE_CONTRACT_FILTER:
      return {
        contracts: state.contracts,
        filter: action.filter,
      }
    default:
      return state;
  }
};

export default reducer;
