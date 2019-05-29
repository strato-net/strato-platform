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
  PRELOAD_TRANSACTION_TYPES,
  UPDATE_TRANSACTION_TYPES,
  PRELOAD_HEALTH,
  UPDATE_HEALTH,
  PRELOAD_NODE_UPTIME,
  UPDATE_NODE_UPTIME, PRELOAD_SYSTEM_INFO, UPDATE_SYSTEM_INFO
} from './dashboard.action'

const initialState = {
  lastBlockNumber: 0,
  usersCount: 0,
  contractsCount: 0,
  transactionsCount: [],
  blockPropagation: [],
  blockDifficulty: [],
  transactionTypes: [],
  healthStatus: false,
  uptime: 0,
  systemStatus:false,
  systemWarnings: "",
  ifHovering:false
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

    case PRELOAD_HEALTH:
      return {
        ...state,
        healthStatus: action.data
      }

    case UPDATE_HEALTH:
      return {
        ...state,
          uptime: action.data
      }

    case PRELOAD_NODE_UPTIME:
      return {
        ...state,
        healthStatus: action.data
      }

    case UPDATE_NODE_UPTIME:
      return {
        ...state,
        uptime: action.data
      }

    case PRELOAD_SYSTEM_INFO:
      return {
        ...state,
        systemStatus: action.data.status
      }

    case UPDATE_SYSTEM_INFO:
      return {
        ...state,
        systemWarnings: action.data.warnings
      }

    default:
      return state;
  }
};

export default reducer;
