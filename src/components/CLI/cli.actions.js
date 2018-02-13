export const OPEN_OVERLAY = "OPEN_TOKEN_MODAL";
export const CLOSE_OVERLAY = "CLOSE_TOKEN_MODAL";

export const openCLIOverlay = function() {
  return {
    type: OPEN_OVERLAY
  }
}

export const closeCLIOverlay = function() {
  return {
    type: CLOSE_OVERLAY
  }
}
