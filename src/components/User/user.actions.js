export const LOGIN_REQUEST = 'LOGIN_REQUEST';
export const LOGIN_REQUEST_SUCCESS = 'LOGIN_REQUEST_SUCCESS';
export const LOGIN_REQUEST_FAILURE = 'LOGIN_REQUEST_FAILURE';
export const LOGOUT_REQUEST = 'LOGOUT_REQUEST';
export const LOGOUT_REQUEST_SUCCESS = 'LOGOUT_REQUEST_SUCCESS';
export const SET_CURRENT_USER = 'SET_CURRENT_USER';

export const login = function (payload) {
  return {
    type: LOGIN_REQUEST,
    email: payload.email,
    password: payload.password
  }
}

export const loginSuccess = function (email, response) {
  return {
    type: LOGIN_REQUEST_SUCCESS,
    email,
    currentUser: response
  }
}

export const loginFailure = function (email, error) {
  return {
    type: LOGIN_REQUEST_FAILURE,
    email,
    error
  }
}

export const logout = function () {
  return {
    type: LOGOUT_REQUEST
  }
}

export const logoutSuccess = function () {
  return {
    type: LOGOUT_REQUEST_SUCCESS
  }
}

export const setCurrentUser = function (jwtResponse) {
  return {
    type: SET_CURRENT_USER,
    currentUser: jwtResponse
  }
}