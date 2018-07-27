import {
  FETCH_CHAINS,
  FETCH_CHAINSS_SUCCESSFULL,
  FETCH_CHAINSS_FAILED
} from './chains.actions';

const initialState = {
  chains: {},
  error: null,
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case FETCH_CHAINS:
      return {
        ...state,
        chains: state.chains,
        error: null,
      };
    case FETCH_CHAINS_SUCCESSFULL:
      const chains = action.chains.reduce(function (result, item) {
        result[item] = {};
        return result;
      }, {});
      return {
        ...state,
        chains: chains
        error: null,
      };
    case FETCH_CHAINS_FAILED:
      return {
        ...state,
        chains: state.chains,
        error: action.error
      };
    default:
      return state;
  }
};

export default reducer;
