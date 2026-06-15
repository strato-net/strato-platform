import {
  FETCH_CHAINS_REQUEST,
  FETCH_CHAINS_SUCCESS,
  CHANGE_CHAIN_FILTER,
  FETCH_CHAIN_DETAIL_SUCCESS,
  FETCH_CHAIN_DETAIL_FAILURE,
  RESET_CHAIN_ID,
  RESET_INITIAL_LABLE,
  FETCH_CHAINS_IDS_FAILURE,
  FETCH_CHAINS_IDS_SUCCESS,
  GET_LABEL_IDS,
  SELECT_CHAIN,
  FETCH_CHAINS_FAILURE,
  FETCH_SELECT_CHAIN_DETAIL_SUCCESS
} from './chains.actions';

const initialState = {
  chains: {},
  labelIds: {},
  filter: '',
  initialLabel: null,
  error: null,
  listChain: {},
  listLabelIds: {},
  chainIds: [],
  selectedChain: null,
  isLoading: false
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case FETCH_CHAINS_REQUEST:
      return {
        ...state,
        filter: null,
        error: null,
        isLoading: true
      };
    case FETCH_CHAINS_SUCCESS:
      const chainLabelIds = {};
      const chains = action.chainLabelIds;
      // this will create an object of chain with label and their address
      chains.forEach((chain) => {
        const id = chain.id;
        const label = chain.info.label;
        if (!chainLabelIds[label]) {
          chainLabelIds[label] = {};
          chainLabelIds[label][id] = {};
        } else {
          chainLabelIds[label][id] = {};
        }
      });
      return {
        ...state,
        chains: chainLabelIds,
        labelIds: chainLabelIds,
        initialLabel: chains.length && chains[0].info.label,
        filter: state.filter,
        error: null,
        isLoading: false
      };
    case FETCH_CHAINS_FAILURE:
      return {
        ...state,
        chains: state.chains,
        labelIds: state.labelIds,
        filter: state.filter,
        error: action.error,
        isLoading: false
      };
    case CHANGE_CHAIN_FILTER:
      return {
        ...state,
        chains: state.chains,
        labelIds: state.labelIds,
        filter: action.filter,
        error: state.error,
      }
    case FETCH_CHAIN_DETAIL_SUCCESS:
      return {
        ...state,
        chains: {
          ...state.chains,
          [action.label]: {
            ...state.chains[action.label],
            [action.id]: {
              ...action.detail[0]
            }
          }
        },
        labelIds: state.labelIds,
        filter: state.filter,
        error: state.error
      }
    case FETCH_SELECT_CHAIN_DETAIL_SUCCESS:
      const chainLabelIds_2 = {};
      action.detail.forEach((chain) => {
        const id = chain.id;
        const label = chain.info.label;
        if (!chainLabelIds_2[label]) {
          chainLabelIds_2[label] = {};
          chainLabelIds_2[label][id] = {};
        } else {
          chainLabelIds_2[label][id] = {};
        }
      });
      return {
        ...state,
        chains: chainLabelIds_2,
        labelIds: chainLabelIds_2,
        chainIds: [action.detail[0], ...state.chainIds],
        selectedChain: action.detail[0].id,
        isLoading: false,
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
    case RESET_INITIAL_LABLE:
      return {
        ...state,
        initialLabel: null
      }
    case FETCH_CHAINS_IDS_SUCCESS:
      const newChain = {};
      action.chain.forEach((chain) => {
        const id = chain.id;
        const label = chain.info.label;
        if (!newChain[label]) {
          newChain[label] = {};
          newChain[label][id] = {};
        } else {
          newChain[label][id] = {};
        }
      });
      return {
        ...state,
        listChain: newChain,
        chainIds: action.chain.map((chain) => {return {id: chain.id, label: chain.info.label}} )
      }
    case FETCH_CHAINS_IDS_FAILURE:
      return {
        ...state,
        listChain: [],
        error: action.error
      }
    case GET_LABEL_IDS:
      return {
        ...state,
        listLabelIds: state.listChain[action.label]
      }
    case SELECT_CHAIN:
      return {
        ...state,
        selectedChain: action.chainId
      }
    default:
      return state;
  }
};

export default reducer;
