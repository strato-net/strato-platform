import {
  FETCH_CHAINS,
  FETCH_CHAINS_SUCCESSFULL,
  FETCH_CHAINS_FAILED,
  CHANGE_CHAIN_FILTER,
  RESET_CHAIN_ID,
  FETCH_CHAIN_DETAIL_SUCCESS,
  FETCH_CHAIN_DETAIL_FAILURE,
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
      return {
        ...state,
        chainLabels: chainLabels,
        chainIds: chainIds,
        chains: state.chains,
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
    case FETCH_CHAIN_DETAIL_SUCCESS:
      return {
        ...state,
        chains: {
          ...state.chainLabels,
          [action.label]: {
            ...state.chainLabels[action.label],
            [action.id]: {
              ...action.detail,
              error: null
            }
          }
        },
        filter: state.filter,
        error: state.error,
        currentUserBalance: state.currentUserBalance
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
    case FETCH_CHAIN_DETAIL_FAILURE:
      return {
        ...state,
        chains: {
          ...state.chainLabels,
          [action.label]: {
            ...state.chainLabels[action.label],
            [action.id]: {
              error: action.error
            }
          }
        },
        filter: state.filter,
        error: state.error,
      }
    default:
      return state;
  }
};

export default reducer;
