import {
  FETCH_CHAINS,
  FETCH_CHAINS_SUCCESSFULL,
  FETCH_CHAINS_FAILED,
  CHANGE_CHAIN_FILTER,
  FETCH_CHAIN_IDS_SUCCESSFUL,
  FETCH_CHAIN_IDS_FAILED,
  FETCH_CHAIN_DETAIL_SUCCESS,
  FETCH_CHAIN_DETAIL_FAILURE,
  RESET_CHAIN_ID
} from './chains.actions';

const initialState = {
  chains: {},
  labelIds: {},
  filter: '',
  error: null,
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case FETCH_CHAINS:
      return {
        ...state,
        chains: state.chains,
        labelIds: state.labelIds,
        filter: state.filter,
        error: null,
      };
    case FETCH_CHAINS_SUCCESSFULL:
      return {
        ...state,
        chains: action.chainLabelIds,
        labelIds: action.chainLabelIds,
        filter: state.filter,
        error: null
      };
    case FETCH_CHAINS_FAILED:
      return {
        ...state,
        chains: state.chains,
        labelIds: state.labelIds,
        filter: state.filter,
        error: action.error
      };
    case CHANGE_CHAIN_FILTER:
      return {
        ...state,
        chains: state.chains,
        labelIds: state.labelIds,
        filter: action.filter,
        error: state.error,
      }
    case FETCH_CHAIN_IDS_SUCCESSFUL:
      return {
        ...state,
        chains: state.chains,
        labelIds: state.labelIds,
        filter: state.filter,
        error: state.error
      }
    case FETCH_CHAIN_IDS_FAILED:
      return {
        ...state,
        chains: {
          ...state.chains,
          [action.label]: {
            error: action.error
          }
        },
        labelIds: state.labelIds,
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
        labelIds: state.labelIds,
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
        labelIds: state.labelIds,
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
        labelIds: state.labelIds,
        filter: state.filter,
        error: state.error
      }
    default:
      return state;
  }
};

export default reducer;
