export const PRELOAD_BLOCK_NUMBER = 'PRELOAD_BLOCK_NUMBER'
export const UPDATE_BLOCK_NUMBER = 'UPDATE_BLOCK_NUMBER'
export const PRELOAD_CONTRACT_COUNT = 'PRELOAD_CONTRACT_COUNT'
export const UPDATE_CONTRACT_COUNT = 'UPDATE_CONTRACT_COUNT'
export const PRELOAD_USERS_COUNT = 'PRELOAD_USERS_COUNT'
export const UPDATE_USERS_COUNT = 'UPDATE_USERS_COUNT'

// will trigger from socket.saga and update the dashboard store
export const preloadBlockNumber = function (data) {
  return {
    type: PRELOAD_BLOCK_NUMBER,
    data
  }
}

// will trigger from socket.saga and update the dashboard store
export const updateBlockNumber = function (data) {
  return {
    type: UPDATE_BLOCK_NUMBER,
    data
  }
}

// will trigger from socket.saga and update the dashboard store
export const preloadContractCount = function (data) {
  return {
    type: PRELOAD_CONTRACT_COUNT,
    data
  }
}

// will trigger from socket.saga and update the dashboard store
export const updateContractCount = function (data) {
  return {
    type: UPDATE_CONTRACT_COUNT,
    data
  }
}

// will trigger from socket.saga and update the dashboard store
export const preloadUsersCount = function (data) {
  return {
    type: PRELOAD_USERS_COUNT,
    data
  }
}

// will trigger from socket.saga and update the dashboard store
export const updateUsersCount = function (data) {
  return {
    type: UPDATE_USERS_COUNT,
    data
  }
}

