export const OPEN_OVERLAY = "OPEN_TOKEN_MODAL";
export const CLOSE_OVERLAY = "CLOSE_TOKEN_MODAL";
export const FAUCET_REQUEST = "FAUCET_REQUEST";
export const FAUCET_SUCCESS = "FAUCET_SUCCESS";
export const FAUCET_FAILURE = "FAUCET_FAILURE";

export const openFaucetOverlay = function() {
  return {
    type: OPEN_OVERLAY,
    isTokenOpen: true
  }
}

export const closeFaucetOverlay = function() {
  return {
    type: CLOSE_OVERLAY,
    isTokenOpen: false
  }
}

export const faucetRequest = function(username, password) {
  return {
    type: FAUCET_REQUEST,
    username,
    password,
    spinning: true,
    isTokenOpen: true,
  }
}

export const faucetSuccess = function(key) {
  return {
    type: FAUCET_SUCCESS,
    key: key,
    spinning: false,
    isTokenOpen: false,
  }
}

export const faucetFailure = function(error) {
  return {
    type: FAUCET_FAILURE,
    error: error,
    spinning: false,
    isTokenOpen: false,
  }
}