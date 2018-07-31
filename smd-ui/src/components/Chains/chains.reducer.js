import {
  FETCH_CHAINS,
  FETCH_CHAINS_SUCCESSFULL,
  FETCH_CHAINS_FAILED,
  CHANGE_CHAIN_FILTER,
  RESET_CHAIN_ID
} from './chains.actions';

const initialState = {
  chainLabels: {},
  chainIds: {},
  chains: {},
  filter: '',
  error: null,
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case FETCH_CHAINS:
      return {
        ...state,
        chainLabels: state.chainLabels,
        chainIds: state.chainIds,
        chains: state.chains,
        filter: state.filter,
        error: null,
      };
    case FETCH_CHAINS_SUCCESSFULL:
      const chainLabels = action.chainLabels.reduce(function (result, item) {
        result[item] = {};
        return result;
      }, {});
      const chainIds = action.chainIds.reduce(function (result, item) {
        result[item] = {};
        return result;
      }, {});
      const chains = {};
      action.chainLabels.forEach(function(label, index){
        let details = {};
        let curId = action.chainIds[index];
        details[curId] = action.chainInfos[index];
        chains[label] = details;
      });
      return {
        ...state,
        chainLabels: chainLabels,
        chainIds: chainIds,
        chains: chains,
        filter: state.filter,
        error: null
      };
    case FETCH_CHAINS_FAILED:
      return {
        ...state,
        chainLabels: state.chainLabels,
        chainIds: state.chainIds,
        chains: state.chains,
        filter: state.filter,
        error: action.error
      };
    case CHANGE_CHAIN_FILTER:
      return {
        ...state,
        chainLabels: state.chainLabels,
        chainIds: state.chainIds,
        filter: action.filter,
        chains: state.chains,
        error: state.error,
      }
    case RESET_CHAIN_ID:
      return {
        ...state,
        chains: {
          ...state.chainLabels,
          [action.label]: {}
        },
        filter: state.filter,
        error: state.error
      }
    default:
      return state;
  }
};

export default reducer;
