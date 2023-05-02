export const GET_OR_CREATE_OAUTH_USER_REQUEST = 'GET_OR_CREATE_OAUTH_USER_REQUEST';
export const GET_OR_CREATE_OAUTH_USER_SUCCESS = 'GET_OR_CREATE_OAUTH_USER_SUCCESS';
export const GET_OR_CREATE_OAUTH_USER_FAILURE = 'GET_OR_CREATE_OAUTH_USER_FAILURE';
export const FETCH_USER_PUBLIC_KEY_REQUEST = "FETCH_USER_PUBLIC_KEY_REQUEST";
export const FETCH_USER_PUBLIC_KEY_SUCCESS = "FETCH_USER_PUBLIC_KEY_SUCCESS";
export const FETCH_USER_PUBLIC_KEY_FAILURE = "FETCH_USER_PUBLIC_KEY_FAILURE";
export const FETCH_USER_CERT_REQUEST = "FETCH_USER_PUBLIC_KEY_REQUEST";
export const FETCH_USER_CERT_SUCCESS = "FETCH_USER_CERT_SUCCESS";
export const FETCH_USER_CERT_FAILURE = "FETCH_USER_CERT_FAILURE";

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

export const fetchUserPubkey = function() {
  return {
    type : FETCH_USER_PUBLIC_KEY_REQUEST
  }
}

export const fetchUserPubKeySuccess = function(publicKey) {
  return {
    type : FETCH_USER_PUBLIC_KEY_SUCCESS,
    publicKey
  }
}

export const fetchUserPubKeyFailure = function(error) {
  return {
    type : FETCH_USER_PUBLIC_KEY_FAILURE,
    error
  }
}

export const getUserCertificateRequest = function(userAddress) {
  return {
    type : FETCH_USER_CERT_REQUEST,
    userAddress
  }
}

export const getUserCertificateSuccess = function(cert) {
  return {
    type : FETCH_USER_CERT_SUCCESS,
    cert
  }
}

export const getUserCertificateFailure = function(error) {
  return {
    type : FETCH_USER_CERT_FAILURE,
    error
  }
}
