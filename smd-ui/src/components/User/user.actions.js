export const LOGIN_REQUEST = 'LOGIN_REQUEST';
export const LOGIN_REQUEST_SUCCESS = 'LOGIN_REQUEST_SUCCESS';
export const LOGIN_REQUEST_FAILURE = 'LOGIN_REQUEST_FAILURE';
export const LOGOUT_REQUEST = 'LOGOUT_REQUEST';
export const LOGOUT_REQUEST_SUCCESS = 'LOGOUT_REQUEST_SUCCESS';
export const SET_CURRENT_USER = 'SET_CURRENT_USER';
export const OPEN_LOGIN_OVERLAY = 'OPEN_LOGIN_OVERLAY';
export const CLOSE_LOGIN_OVERLAY = 'CLOSE_LOGIN_OVERLAY';
export const RESET_ERROR = 'RESET_ERROR';
export const FIRST_TIME_LOGIN_REQUEST = 'FIRST_TIME_LOGIN_REQUEST';
export const FIRST_TIME_LOGIN_REQUEST_SUCCESS = 'FIRST_TIME_LOGIN_REQUEST_SUCCESS';
export const FIRST_TIME_LOGIN_REQUEST_FAILURE = 'FIRST_TIME_LOGIN_REQUEST_FAILURE';
export const RESET_FIRST_TIME_USER = 'RESET_FIRST_TIME_USER';
export const GET_KEY_REQUEST = 'GET_KEY_REQUEST';
export const GET_KEY_SUCCESS = 'GET_KEY_SUCCESS';
export const GET_KEY_FAILURE = 'GET_KEY_FAILURE';
export const CREATE_OAUTH_USER_REQUEST = 'CREATE_OAUTH_USER_REQUEST';
export const CREATE_OAUTH_USER_SUCCESS = 'CREATE_OAUTH_USER_SUCCESS';
export const CREATE_OAUTH_USER_FAILURE = 'CREATE_OAUTH_USER_FAILURE';

export const login = function (payload) {
  return {
    type: LOGIN_REQUEST,
    username: payload.username,
    password: payload.password
  }
}

export const loginSuccess = function (username, response) {
  return {
    type: LOGIN_REQUEST_SUCCESS,
    username,
    currentUser: response
  }
}

export const loginFailure = function (username, error) {
  return {
    type: LOGIN_REQUEST_FAILURE,
    username,
    error
  }
}

export const openLoginOverlay = function () {
  return {
    type: OPEN_LOGIN_OVERLAY,
    isOpen: true
  }
}

export const closeLoginOverlay = function () {
  return {
    type: CLOSE_LOGIN_OVERLAY,
    isOpen: false
  }
}

export const logout = function () {
  return {
    type: LOGOUT_REQUEST
  }
}

export const logoutSuccess = function () {
  return {
    type: LOGOUT_REQUEST_SUCCESS,
  }
}

export const setCurrentUser = function (jwtResponse) {
  return {
    type: SET_CURRENT_USER,
    currentUser: jwtResponse
  }
}

export const resetError = function () {
  return {
    type: RESET_ERROR
  }
}

export const firstTimeLogin = function (email) {
  return {
    type: FIRST_TIME_LOGIN_REQUEST,
    email
  }
}

export const firstTimeLoginSuccess = function (email) {
  return {
    type: FIRST_TIME_LOGIN_REQUEST_SUCCESS,
    email,
  }
}

export const firstTimeLoginFailure = function (email, error) {
  return {
    type: FIRST_TIME_LOGIN_REQUEST_FAILURE,
    error
  }
}

export const resetFirstTimeUser = function () {
  return {
    type: RESET_FIRST_TIME_USER
  }
}

export const getKeyRequest = function () {
  return {
    type: GET_KEY_REQUEST
  }
}

export const getKeySuccess = function (data) {
  return {
    type: GET_KEY_SUCCESS,
    data
  }
}

export const getKeyFailure = function (error) {
  return {
    type: GET_KEY_FAILURE,
    error
  }
}

export const createOauthUserRequest = function () {
  return {
    type: CREATE_OAUTH_USER_REQUEST
  }
}

export const createOauthUserSuccess = function (data) {
  return {
    type: CREATE_OAUTH_USER_SUCCESS,
    data
  }
}

export const createOauthUserFailure = function (error) {
  return {
    type: CREATE_OAUTH_USER_FAILURE,
    error
  }
}