import {
  PRELOAD_BLOCK_NUMBER,
  UPDATE_BLOCK_NUMBER,
  PRELOAD_CONTRACT_COUNT,
  UPDATE_CONTRACT_COUNT,
  PRELOAD_USERS_COUNT,
  UPDATE_USERS_COUNT,
  PRELOAD_TRANSACTION_COUNT,
  UPDATE_TRANSACTION_COUNT,
  PRELOAD_BLOCK_PROPAGATION,
  UPDATE_BLOCK_PROPAGATION,
  PRELOAD_BLOCK_DIFFICULTY,
  UPDATE_BLOCK_DIFFICULTY,
  PRELOAD_BLOCK_FREQUENCY,
  UPDATE_BLOCK_FREQUENCY,
  PRELOAD_PEERS,
  UPDATE_PEERS,
  PRELOAD_TRANSACTION_TYPES,
  UPDATE_TRANSACTION_TYPES
} from './dashboard.action'

const initialState = {
  lastBlockNumber: 0,
  usersCount: 0,
  contractsCount: 0,
  transactionsCount: 0,
  blockPropagation: undefined,
  blockFrequency: undefined,
  blockDifficulty: undefined,
  transactionTypes: undefined,
  peers: undefined
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case PRELOAD_BLOCK_NUMBER:
      return {
        ...state,
        lastBlockNumber: action.data
      };

    case UPDATE_BLOCK_NUMBER:
      return {
        ...state,
        lastBlockNumber: action.data
      };

    case PRELOAD_CONTRACT_COUNT:
      return {
        ...state,
        contractsCount: action.data
      }

    case UPDATE_CONTRACT_COUNT:
      return {
        ...state,
        contractsCount: action.data
      };

    case PRELOAD_USERS_COUNT:
      return {
        ...state,
        usersCount: action.data
      };

    case UPDATE_USERS_COUNT:
      return {
        ...state,
        usersCount: action.data
      };

    case PRELOAD_TRANSACTION_COUNT:
      return {
        ...state,
        transactionsCount: action.data
      };

    case UPDATE_TRANSACTION_COUNT:
      return {
        ...state,
        transactionsCount: action.data
      }

    case PRELOAD_BLOCK_DIFFICULTY:
      return {
        ...state,
        blockDifficulty: action.data
      }

    case UPDATE_BLOCK_DIFFICULTY:
      return {
        ...state,
        blockDifficulty: action.data
      }

    case PRELOAD_BLOCK_FREQUENCY:
      return {
        ...state,
        blockFrequency: action.data
      }

    case UPDATE_BLOCK_FREQUENCY:
      return {
        ...state,
        blockFrequency: action.data
      }

    case PRELOAD_BLOCK_PROPAGATION:
      return {
        ...state,
        blockPropagation: action.data
      }

    case UPDATE_BLOCK_PROPAGATION:
      return {
        ...state,
        blockPropagation: action.data
      }

    case PRELOAD_PEERS:
      return {
        ...state,
        peers: action.data
      }

    case UPDATE_PEERS:
      return {
        ...state,
        peers: action.data
      }

    case PRELOAD_TRANSACTION_TYPES:
      return {
        ...state,
        transactionTypes: action.data
      }

    case UPDATE_TRANSACTION_TYPES:
      return {
        ...state,
        transactionTypes: action.data
      }

    default:
      return state;
  }
};

export default reducer;