export const OPEN_OVERLAY = "BID_OPEN_MODAL";
export const CLOSE_OVERLAY = "BID_CLOSE_MODAL";
export const CREATE_USER_REQUEST = "CREATE_USER_REQUEST";
export const CREATE_USER_SUCCESS = "CREATE_USER_SUCCESS";
export const CREATE_USER_FAILURE = "CREATE_USER_FAILURE";

export const openOverlay = function() {
  return {
    type: OPEN_OVERLAY,
    isOpen: true
  }
}

export const closeOverlay = function() {
  return {
    type: CLOSE_OVERLAY,
    isOpen: false
  }
}

export const createUser = function(username, password) {
  return {
    type: CREATE_USER_REQUEST,
    username,
    password,
    spinning: true,
    isOpen: true,
  }
}

export const createUserSuccess = function(key) {
  return {
    type: CREATE_USER_SUCCESS,
    key: key,
    spinning: false,
    isOpen: false,
  }
}

export const createUserFailure = function(error) {
  return {
    type: CREATE_USER_FAILURE,
    error: error,
    spinning: false,
    isOpen: false,
  }
}