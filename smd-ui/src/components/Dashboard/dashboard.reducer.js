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

// Load persisted data on initialization
const loadPersistedData = () => {
  try {
    const stored = localStorage.getItem('dashboardData');
    if (!stored) return null;
    const { data, timestamp } = JSON.parse(stored);
    // 5 minute expiry
    if (Date.now() - timestamp > 300000) {
      localStorage.removeItem('dashboardData');
      return null;
    }
    return data;
  } catch (error) {
    return null;
  }
};

const persistedData = loadPersistedData();

const initialState = {
  shardCount: persistedData && persistedData.shardCount || 0,
  lastBlockNumber: persistedData && persistedData.lastBlockNumber || 0,
  usersCount: persistedData && persistedData.usersCount || 0,
  contractsCount: persistedData && persistedData.contractsCount || 0,
  transactionsCount: persistedData && persistedData.transactionsCount || [],
  blockPropagation: persistedData && persistedData.blockPropagation || [],
  blockDifficulty: persistedData && persistedData.blockDifficulty || [],
  transactionTypes: persistedData && persistedData.transactionTypes || [],
  healthStatus: persistedData && persistedData.healthStatus || false,
  uptime: persistedData && persistedData.uptime || 0,
  systemStatus: persistedData && persistedData.systemStatus || false,
  systemWarnings: persistedData && persistedData.systemWarnings || "",
  ifHovering: false,
  networkStatus: persistedData && persistedData.networkStatus || false,
};

const reducer = function (state = initialState, action) {
  let newState;
  
  switch (action.type) {
    case PRELOAD_BLOCK_NUMBER:
    case UPDATE_BLOCK_NUMBER:
      newState = {
        ...state,
        lastBlockNumber: action.data,
      };
      break;

    case PRELOAD_CONTRACT_COUNT:
    case UPDATE_CONTRACT_COUNT:
      newState = {
        ...state,
        contractsCount: action.data,
      };
      break;

    case PRELOAD_USERS_COUNT:
    case UPDATE_USERS_COUNT:
      newState = {
        ...state,
        usersCount: action.data,
      };
      break;
      
    case PRELOAD_SHARD_COUNT:
    case UPDATE_SHARD_COUNT:
      newState = {
        ...state,
        shardCount: action.data,
      };
      break;

    case PRELOAD_TRANSACTION_COUNT:
    case UPDATE_TRANSACTION_COUNT:
      newState = {
        ...state,
        transactionsCount: action.data,
      };
      break;

    case PRELOAD_BLOCK_DIFFICULTY:
    case UPDATE_BLOCK_DIFFICULTY:
      newState = {
        ...state,
        blockDifficulty: action.data,
      };
      break;

    case PRELOAD_BLOCK_PROPAGATION:
    case UPDATE_BLOCK_PROPAGATION:
      newState = {
        ...state,
        blockPropagation: action.data,
      };
      break;

    case PRELOAD_TRANSACTION_TYPES:
    case UPDATE_TRANSACTION_TYPES:
      newState = {
        ...state,
        transactionTypes: action.data,
      };
      break;

    case PRELOAD_HEALTH:
    case UPDATE_HEALTH:
      newState = {
        ...state,
        healthStatus: action.data.healthStatus,
        health: action.data.health,
        healthIssues: action.data.healthIssues,
      };
      break;

    case PRELOAD_NODE_UPTIME:
    case UPDATE_NODE_UPTIME:
      newState = {
        ...state,
        uptime: action.data,
      };
      break;  

    case PRELOAD_SYSTEM_INFO:
    case UPDATE_SYSTEM_INFO:
      newState = {
        ...state,
        systemStatus: action.data.status,
        systemWarnings: action.data.warnings,
        systemInfo: action.data.systemInfo,
      };
      break;

    case PRELOAD_NETWORK_HEALTH:
    case UPDATE_NETWORK_HEALTH:
      newState = {
        ...state,
        networkStatus: action.data.status,
        networkStatusMessage: action.data.statusMessage,
      };
      break;

    case CHANGE_HEALTH_STATUS:
      newState = {
        ...state,
        healthStatus: action.data,
        systemStatus: action.data,
      };
      break;
      
    default:
      return state;
  }
  
  // Persist data after state update
  try {
    localStorage.setItem('dashboardData', JSON.stringify({
      data: newState,
      timestamp: Date.now()
    }));
  } catch (error) {
    // Ignore localStorage errors
  }
  
  return newState;
};

export default reducer;
