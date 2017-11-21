export const UPDATE_PRELOAD_BLOCK_NUMBER = 'UPDATE_PRELOAD_BLOCK_NUMBER'
export const UPDATE_BLOCK_NUMBER = 'UPDATE_BLOCK_NUMBER'
export const UPDATE_PRELOAD_CONTRACT_COUNT = 'UPDATE_PRELOAD_CONTRACT_COUNT'
export const UPDATE_CONTRACT_COUNT = 'UPDATE_CONTRACT_COUNT'
export const UPDATE_PRELOAD_USERS_COUNT = 'UPDATE_PRELOAD_USERS_COUNT'
export const UPDATE_USERS_COUNT = 'UPDATE_USERS_COUNT'

// will trigger from socket.saga and update the dashboard store
export const updatePreloadBlockNumber = function (data) {
	return {
		type: UPDATE_PRELOAD_BLOCK_NUMBER,
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
export const updatePreloadContractCount = function (data) {
	return {
		type: UPDATE_PRELOAD_CONTRACT_COUNT,
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
export const updatePreloadUsersCount = function (data) {
	return {
		type: UPDATE_PRELOAD_USERS_COUNT,
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






