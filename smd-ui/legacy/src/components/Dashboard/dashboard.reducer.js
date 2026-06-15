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
  UPDATE_NODE_UPTIME,
  PRELOAD_SYSTEM_INFO,
  UPDATE_SYSTEM_INFO,
  CHANGE_HEALTH_STATUS,
  UPDATE_SHARD_COUNT,
  PRELOAD_SHARD_COUNT,
  PRELOAD_NETWORK_HEALTH,
  UPDATE_NETWORK_HEALTH,
} from "./dashboard.action";

const initialState = {
  shardCount: 0,
  lastBlockNumber: 0,
  usersCount: 0,
  contractsCount: 0,
  transactionsCount: [],
  blockPropagation: [],
  blockDifficulty: [],
  transactionTypes: [],
  healthStatus: false,
  uptime: 0,
  systemStatus: false,
  systemWarnings: "",
  ifHovering: false,
  networkStatus: false,
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case PRELOAD_BLOCK_NUMBER:
      return {
        ...state,
        lastBlockNumber: action.data,
      };

    case UPDATE_BLOCK_NUMBER:
      return {
        ...state,
        lastBlockNumber: action.data,
      };

    case PRELOAD_CONTRACT_COUNT:
      return {
        ...state,
        contractsCount: action.data,
      };

    case UPDATE_CONTRACT_COUNT:
      return {
        ...state,
        contractsCount: action.data,
      };

    case PRELOAD_USERS_COUNT:
      return {
        ...state,
        usersCount: action.data,
      };

    case UPDATE_USERS_COUNT:
      return {
        ...state,
        usersCount: action.data,
      };
    case PRELOAD_SHARD_COUNT:
      return {
        ...state,
        shardCount: action.data,
      };

    case UPDATE_SHARD_COUNT:
      return {
        ...state,
        shardCount: action.data,
      };

    case PRELOAD_TRANSACTION_COUNT:
      return {
        ...state,
        transactionsCount: action.data,
      };

    case UPDATE_TRANSACTION_COUNT:
      return {
        ...state,
        transactionsCount: action.data,
      };

    case PRELOAD_BLOCK_DIFFICULTY:
      return {
        ...state,
        blockDifficulty: action.data,
      };

    case UPDATE_BLOCK_DIFFICULTY:
      return {
        ...state,
        blockDifficulty: action.data,
      };

    case PRELOAD_BLOCK_PROPAGATION:
      return {
        ...state,
        blockPropagation: action.data,
      };

    case UPDATE_BLOCK_PROPAGATION:
      return {
        ...state,
        blockPropagation: action.data,
      };

    case PRELOAD_TRANSACTION_TYPES:
      return {
        ...state,
        transactionTypes: action.data,
      };

    case UPDATE_TRANSACTION_TYPES:
      return {
        ...state,
        transactionTypes: action.data,
      };

    case PRELOAD_HEALTH:
      return {
        ...state,
        healthStatus: action.data.healthStatus,
        health: action.data.health,
        healthIssues: action.data.healthIssues,
      };

    case UPDATE_HEALTH:
      return {
        ...state,
        healthStatus: action.data.healthStatus,
        health: action.data.health,
        healthIssues: action.data.healthIssues,
      };

    case PRELOAD_NODE_UPTIME:
      return {
        ...state,
        uptime: action.data,
      };

    case UPDATE_NODE_UPTIME:
      return {
        ...state,
        uptime: action.data,
      };

    case PRELOAD_SYSTEM_INFO:
      return {
        ...state,
        systemStatus: action.data.status,
        systemWarnings: action.data.warnings,
        systemInfo: action.data.systemInfo,
      };

    case UPDATE_SYSTEM_INFO:
      return {
        ...state,
        systemStatus: action.data.status,
        systemWarnings: action.data.warnings,
        systemInfo: action.data.systemInfo,
      };

    case PRELOAD_NETWORK_HEALTH:
      return {
        ...state,
        networkStatus: action.data.status,
        networkStatusMessage: action.data.statusMessage,
      };

    case UPDATE_NETWORK_HEALTH:
      return {
        ...state,
        networkStatus: action.data.status,
        networkStatusMessage: action.data.statusMessage,
      };

    case CHANGE_HEALTH_STATUS:
      return {
        ...state,
        healthStatus: action.data,
        systemStatus: action.data,
      };
    default:
      return state;
  }
};

export default reducer;
