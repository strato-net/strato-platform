export const OPEN_OVERLAY = "BID_OPEN_MODAL";
export const CLOSE_OVERLAY = "BID_CLOSE_MODAL";

export const openOverlay = function() {
  return {
    type: OPEN_OVERLAY,
    isOpen: true
  }
}

export const closeOverlay = function() {
  return {
    type: CLOSE_OVERLAY,
    isOpen: false
  }
}