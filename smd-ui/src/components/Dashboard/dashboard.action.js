export const PRELOAD_BLOCK_NUMBER = "PRELOAD_BLOCK_NUMBER";
export const UPDATE_BLOCK_NUMBER = "UPDATE_BLOCK_NUMBER";
export const PRELOAD_CONTRACT_COUNT = "PRELOAD_CONTRACT_COUNT";
export const UPDATE_CONTRACT_COUNT = "UPDATE_CONTRACT_COUNT";
export const PRELOAD_USERS_COUNT = "PRELOAD_USERS_COUNT";
export const UPDATE_USERS_COUNT = "UPDATE_USERS_COUNT";
export const PRELOAD_TRANSACTION_COUNT = "PRELOAD_TRANSACTION_COUNT";
export const UPDATE_TRANSACTION_COUNT = "UPDATE_TRANSACTION_COUNT";
export const PRELOAD_BLOCK_PROPAGATION = "PRELOAD_BLOCK_PROPAGATION";
export const UPDATE_BLOCK_PROPAGATION = "UPDATE_BLOCK_PROPAGATION";
export const PRELOAD_BLOCK_DIFFICULTY = "PRELOAD_BLOCK_DIFFICULTY";
export const UPDATE_BLOCK_DIFFICULTY = "UPDATE_BLOCK_DIFFICULTY";
export const PRELOAD_TRANSACTION_TYPES = "PRELOAD_TRANSACTION_TYPES";
export const UPDATE_TRANSACTION_TYPES = "UPDATE_TRANSACTION_TYPES";
export const PRELOAD_HEALTH = "PRELOAD_HEALTH";
export const UPDATE_HEALTH = "UPDATE_HEALTH";
export const CHANGE_HEALTH_STATUS = "CHANGE_HEALTH_STATUS";
export const PRELOAD_NODE_UPTIME = "PRELOAD_NODE_UPTIME";
export const UPDATE_NODE_UPTIME = "UPDATE_NODE_UPTIME";
export const PRELOAD_SYSTEM_INFO = "PRELOAD_SYSTEM_INFO";
export const UPDATE_SYSTEM_INFO = "UPDATE_SYSTEM_INFO";
export const PRELOAD_SHARD_COUNT = "PRELOAD_SHARD_COUNT";
export const UPDATE_SHARD_COUNT = "UPDATE_SHARD_COUNT";
export const PRELOAD_NETWORK_HEALTH = "PRELOAD_NETWORK_HEALTH";
export const UPDATE_NETWORK_HEALTH = "UPDATE_NETWORK_HEALTH";

// will trigger from socket.saga and update the dashboard store
export const preloadBlockNumber = function (data) {
  return {
    type: PRELOAD_BLOCK_NUMBER,
    data,
  };
};

// will trigger from socket.saga and update the dashboard store
export const updateBlockNumber = function (data) {
  return {
    type: UPDATE_BLOCK_NUMBER,
    data,
  };
};

// will trigger from socket.saga and update the dashboard store
export const preloadContractCount = function (data) {
  return {
    type: PRELOAD_CONTRACT_COUNT,
    data,
  };
};

// will trigger from socket.saga and update the dashboard store
export const updateContractCount = function (data) {
  return {
    type: UPDATE_CONTRACT_COUNT,
    data,
  };
};

// will trigger from socket.saga and update the dashboard store
export const preloadUsersCount = function (data) {
  return {
    type: PRELOAD_USERS_COUNT,
    data,
  };
};

// will trigger from socket.saga and update the dashboard store
export const updateUsersCount = function (data) {
  return {
    type: UPDATE_USERS_COUNT,
    data,
  };
};

// will trigger from socket.saga and update the dashboard store
export const preloadTransactionsCount = function (data) {
  return {
    type: PRELOAD_TRANSACTION_COUNT,
    data,
  };
};

export const updateTransactionCount = function (data) {
  return {
    type: UPDATE_TRANSACTION_COUNT,
    data,
  };
};

// will trigger from socket.saga and update the dashboard store
export const preloadBlockPropagation = function (data) {
  return {
    type: PRELOAD_BLOCK_PROPAGATION,
    data,
  };
};

export const updateBlockPropagation = function (data) {
  return {
    type: UPDATE_BLOCK_PROPAGATION,
    data,
  };
};

// will trigger from socket.saga and update the dashboard store
export const preloadBlockDifficulty = function (data) {
  return {
    type: PRELOAD_BLOCK_DIFFICULTY,
    data,
  };
};

export const updateBlockDifficulty = function (data) {
  return {
    type: UPDATE_BLOCK_DIFFICULTY,
    data,
  };
};

// will trigger from socket.saga and update the dashboard store
export const preloadTransactionType = function (data) {
  return {
    type: PRELOAD_TRANSACTION_TYPES,
    data,
  };
};

export const updateTransactionType = function (data) {
  return {
    type: UPDATE_TRANSACTION_TYPES,
    data,
  };
};

export const preloadHealth = function (data) {
  return {
    type: PRELOAD_HEALTH,
    data,
  };
};

export const updateHealth = function (data) {
  return {
    type: UPDATE_HEALTH,
    data,
  };
};

export const preloadNodeUptime = function (data) {
  return {
    type: PRELOAD_NODE_UPTIME,
    data,
  };
};

export const updateNodeUptime = function (data) {
  return {
    type: UPDATE_NODE_UPTIME,
    data,
  };
};

export const preloadSystemInfo = function (data) {
  return {
    type: PRELOAD_SYSTEM_INFO,
    data,
  };
};

export const updateSystemInfo = function (data) {
  return {
    type: UPDATE_SYSTEM_INFO,
    data,
  };
};

export const changeHealthStatus = function (data) {
  return {
    type: CHANGE_HEALTH_STATUS,
    data,
  };
};

export const preloadShardCount = (data) => {
  return {
    type: PRELOAD_SHARD_COUNT,
    data,
  };
};
export const updateShardCount = (data) => {
  return {
    type: UPDATE_SHARD_COUNT,
    data,
  };
};

export const preloadNetworkHealth = (data) => {
  return {
    type: PRELOAD_NETWORK_HEALTH,
    data,
  };
};
export const updateNetworkHealth = (data) => {
  return {
    type: UPDATE_NETWORK_HEALTH,
    data,
  };
};
