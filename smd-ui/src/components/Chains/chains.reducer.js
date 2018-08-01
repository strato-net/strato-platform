import {
  FETCH_CHAINS,
  FETCH_CHAINS_SUCCESSFULL,
  FETCH_CHAINS_FAILED,
  CHANGE_CHAIN_FILTER,
  FETCH_CHAIN_ID_SUCCESSFUL,
  FETCH_CHAIN_ID_FAILED,
  FETCH_CHAIN_DETAIL_SUCCESS,
  FETCH_CHAIN_DETAIL_FAILURE,
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
      const chainLabels = action.chainLabels.reduce(function (result, chainLabel) {
        result[chainLabel] = {};
        return result;
      }, {});
      const chainIds = action.chainIds.reduce(function (result, chainId) {
        result[chainId] = {};
        return result;
      }, {});
      const chains = {};
      action.chainLabels.forEach(function(label, index){
        chains[label] = action.chainIds[index];
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
        chains: state.chains,
        filter: action.filter,
        error: state.error,
      }
    case FETCH_CHAIN_ID_SUCCESSFUL:
      const id = {};
      id[action.id] = {
        error: null
      };
      return {
        ...state,
        chains: {
          ...state.chains,
          [action.label]: id
        },
        chainLabels: state.chainLabels,
        chainIds: state.chainIds,
        filter: state.filter,
        error: state.error
      }
    case FETCH_CHAIN_ID_FAILED:
      return {
        ...state,
        chains: {
          ...state.chains,
          [action.label]: {
            error: action.error
          }
        },
        chainLabels: state.chainLabels,
        chainIds: state.chainIds,
        filter: state.filter,
        error: state.error
      }
    case FETCH_CHAIN_DETAIL_SUCCESS:
      return {
        ...state,
        chains: {
          ...state.chains,
          [action.label]: {
            ...state.chains[action.label],
            [action.id]: {
              ...action.detail,
              error: null
            }
          }
        },
        chainLabels: state.chainLabels,
        chainIds: state.chainIds,
        filter: state.filter,
        error: state.error
      }
    case RESET_CHAIN_ID:
      return {
        ...state,
        chains: {
          ...state.chains,
          [action.label]: {}
        },
        chainLabels: state.chainLabels,
        chainIds: state.chainIds,
        filter: state.filter,
        error: state.error
      }
    case FETCH_CHAIN_DETAIL_FAILURE:
      return {
        ...state,
        chains: {
          ...state.chains,
          [action.label]: {
            ...state.chains[action.label],
            [action.id]: {
              error: action.error
            }
          }
        },
        chainLabels: state.chainLabels,
        chainIds: state.chainIds,
        filter: state.filter,
        error: state.error
      }
    default:
      return state;
  }
};

export default reducer;
