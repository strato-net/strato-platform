export const CREATE_USER_REQUEST = "CREATE_USER_REQUEST";
export const CREATE_USER_SUCCESS = "CREATE_USER_SUCCESS";
export const CREATE_USER_FAILURE = "CREATE_USER_FAILURE";
export const RESET_USER_ERROR = "RESET_USER_ERROR";

export const createUser = function(username, password) {
  return {
    type: CREATE_USER_REQUEST,
    username,
    password
  }
}

export const createUserSuccess = function(address, username) {
  return {
    type: CREATE_USER_SUCCESS,
    address,
    username
  }
}

export const createUserFailure = function(error) {
  return {
    type: CREATE_USER_FAILURE,
    error
  }
}

export const resetUserError = function() {
  return {
    type: RESET_USER_ERROR
  }
}