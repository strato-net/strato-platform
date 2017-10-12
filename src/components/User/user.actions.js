export const VERIFY_USER = 'VERIFY_USER';
export const HANDLE_USER_SUCCESS = 'HANDLE_USER_SUCCESS';
export const HANDLE_USER_FAILURE = 'HANDLE_USER_FAILURE';
export const LOGOUT_USER = 'LOGOUT_USER';
export const LOGOUT_USER_SUCCESS = 'LOGOUT_USER_SUCCESS';
export const SET_CURRENT_USER = 'SET_CURRENT_USER';

export const verifyUser = function (payload) {
  return {
    type: VERIFY_USER,
    email: payload.email,
    password: payload.password
  }
}

export const handleUserSuccess = function (email, response) {
  return {
    type: HANDLE_USER_SUCCESS,
    email,
    currentUser: response
  }
}

export const handleUserFailure = function (email, error) {
  return {
    type: HANDLE_USER_FAILURE,
    email,
    error
  }
}

export const logout = function () {
  return {
    type: LOGOUT_USER
  }
}

export const logoutSuccess = function () {
  return {
    type: LOGOUT_USER_SUCCESS
  }
}

export const setCurrentUser = function (jwtResponse) {
  return {
    type: SET_CURRENT_USER,
    currentUser: jwtResponse
  }
}