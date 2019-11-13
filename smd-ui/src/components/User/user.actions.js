export const LOGOUT_REQUEST = 'LOGOUT_REQUEST';
export const LOGOUT_REQUEST_SUCCESS = 'LOGOUT_REQUEST_SUCCESS';
export const GET_OR_CREATE_OAUTH_USER_REQUEST = 'GET_OR_CREATE_OAUTH_USER_REQUEST';
export const GET_OR_CREATE_OAUTH_USER_SUCCESS = 'GET_OR_CREATE_OAUTH_USER_SUCCESS';
export const GET_OR_CREATE_OAUTH_USER_FAILURE = 'GET_OR_CREATE_OAUTH_USER_FAILURE';

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

export const getOrCreateOauthUserRequest = function () {
  return {
    type: GET_OR_CREATE_OAUTH_USER_REQUEST
  }
}

export const getOrCreateOauthUserSuccess = function (data) {
  return {
    type: GET_OR_CREATE_OAUTH_USER_SUCCESS,
    data
  }
}

export const getOrCreateOauthUserFailure = function (error) {
  return {
    type: GET_OR_CREATE_OAUTH_USER_FAILURE,
    error
  }
}