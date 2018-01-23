export const CREATE_USER_REQUEST = "CREATE_USER_REQUEST";
export const CREATE_USER_SUCCESS = "CREATE_USER_SUCCESS";
export const CREATE_USER_FAILURE = "CREATE_USER_FAILURE";

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