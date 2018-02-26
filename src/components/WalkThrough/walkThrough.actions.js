export const OPEN_OVERLAY = "OPEN_WALKTHROUGH_MODAL";
export const CLOSE_OVERLAY = "CLOSE_WALKTHROUGH_MODAL";
export const FAUCET_REQUEST = "FAUCET_REQUEST";
export const FAUCET_SUCCESS = "FAUCET_SUCCESS";
export const FAUCET_FAILURE = "FAUCET_FAILURE";

export const openWalkThroughOverlay = function (isLoggedIn) {
  return {
    type: OPEN_OVERLAY,
    isLoggedIn
  }
}

export const closeWalkThroughOverlay = function () {
  return {
    type: CLOSE_OVERLAY
  }
}