export const OPEN_OVERLAY = "BID_OPEN_MODAL";
export const CLOSE_OVERLAY = "BID_CLOSE_MODAL";
export const FAUCET_REQUEST = "FAUCET_REQUEST";
export const FAUCET_SUCCESS = "FAUCET_SUCCESS";
export const FAUCET_FAILURE = "FAUCET_FAILURE";

export const openFaucetOverlay = function() {
  return {
    type: OPEN_OVERLAY,
    isOpen: true
  }
}

export const closeFaucetOverlay = function() {
  return {
    type: CLOSE_OVERLAY,
    isOpen: false
  }
}

export const faucetRequest = function(username, password) {
  return {
    type: FAUCET_REQUEST,
    username,
    password,
    spinning: true,
    isOpen: true,
  }
}

export const faucetSuccess = function(key) {
  return {
    type: FAUCET_SUCCESS,
    key: key,
    spinning: false,
    isOpen: false,
  }
}

export const faucetFailure = function(error) {
  return {
    type: FAUCET_FAILURE,
    error: error,
    spinning: false,
    isOpen: false,
  }
}