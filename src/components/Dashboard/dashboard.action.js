export const PRELOAD_BLOCK_NUMBER = 'PRELOAD_BLOCK_NUMBER'
export const UPDATE_BLOCK_NUMBER = 'UPDATE_BLOCK_NUMBER'
export const PRELOAD_CONTRACT_COUNT = 'PRELOAD_CONTRACT_COUNT'
export const UPDATE_CONTRACT_COUNT = 'UPDATE_CONTRACT_COUNT'
export const PRELOAD_USERS_COUNT = 'PRELOAD_USERS_COUNT'
export const UPDATE_USERS_COUNT = 'UPDATE_USERS_COUNT'
export const PRELOAD_TRANSACTION_COUNT = 'PRELOAD_TRANSACTION_COUNT'
export const UPDATE_TRANSACTION_COUNT = 'UPDATE_TRANSACTION_COUNT'
export const PRELOAD_BLOCK_PROPAGATION = 'PRELOAD_BLOCK_PROPAGATION'
export const UPDATE_BLOCK_PROPAGATION = 'UPDATE_BLOCK_PROPAGATION'
export const PRELOAD_BLOCK_DIFFICULTY = 'PRELOAD_BLOCK_DIFFICULTY'
export const UPDATE_BLOCK_DIFFICULTY = 'UPDATE_BLOCK_DIFFICULTY'
export const PRELOAD_BLOCK_FREQUENCY = 'PRELOAD_BLOCK_FREQUENCY'
export const UPDATE_BLOCK_FREQUENCY = 'UPDATE_BLOCK_FREQUENCY'
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

// will trigger from socket.saga and update the dashboard store
export const preloadTransactionsCount = function (data) {
	return {
		type: PRELOAD_TRANSACTION_COUNT,
		data
	}
}

export const updateTransactionCount = function (data) {
	return {
		type: UPDATE_TRANSACTION_COUNT,
		data
	}
} 

// will trigger from socket.saga and update the dashboard store
export const preloadBlockPropagation = function (data) {
	return {
		type: PRELOAD_BLOCK_PROPAGATION,
		data
	}
}

export const updateBlockPropagation = function (data) {
	return {
		type: UPDATE_BLOCK_PROPAGATION,
		data
	}
} 

// will trigger from socket.saga and update the dashboard store
export const preloadBlockDifficulty = function (data) {
	return {
		type: PRELOAD_BLOCK_DIFFICULTY,
		data
	}
}

export const updateBlockDifficulty = function (data) {
	return {
		type: UPDATE_BLOCK_DIFFICULTY,
		data
	}
} 

// will trigger from socket.saga and update the dashboard store
export const preloadBlockFrequency = function (data) {
	return {
		type: PRELOAD_BLOCK_FREQUENCY,
		data
	}
}

export const updateBlockFrequency = function (data) {
	return {
		type: UPDATE_BLOCK_FREQUENCY,
		data
	}
} 