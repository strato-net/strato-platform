export const CREATE_USER_REQUEST = "CREATE_USER_REQUEST";
export const CREATE_USER_SUCCESS = "CREATE_USER_SUCCESS";
export const CREATE_USER_FAILURE = "CREATE_USER_FAILURE";
export const RESET_ERROR = "RESET_ERROR";

export const createUser = function (username, password) {
  return {
    type: CREATE_USER_REQUEST,
    username,
    password,
    spinning: true,
  }
}

export const createUserSuccess = function (key) {
  return {
    type: CREATE_USER_SUCCESS,
    key: key,
    spinning: false,
  }
}

export const createUserFailure = function (error) {
  return {
    type: CREATE_USER_FAILURE,
    error: error,
    spinning: false,
  }
}

export const resetError = function (error) {
  return {
    type: RESET_ERROR
  }
}