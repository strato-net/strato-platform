export const OPEN_OVERLAY = "OPEN_CHAIN_MODAL";
export const CLOSE_OVERLAY = "CLOSE_CHAIN_MODAL";
export const CREATE_CHAIN_REQUEST = "CREATE_CHAIN_REQUEST";
export const CREATE_CHAIN_SUCCESS = "CREATE_CHAIN_SUCCESS";
export const CREATE_CHAIN_FAILURE = "CREATE_CHAIN_FAILURE";

export const openCreateChainOverlay = function () {
  return {
    type: OPEN_OVERLAY,
    isOpen: true
  }
}

export const closeCreateChainOverlay = function () {
  return {
    type: CLOSE_OVERLAY,
    isOpen: false
  }
}

export const createChain = function (src, label, acctInfo, vars, members) {
  return {
    type: CREATE_CHAIN_REQUEST,
    src,
    label,
    acctInfo,
    vars,
    members,
    spinning: true,
    isOpen: true,
  }
}

export const createChainSuccess = function (key) {
  return {
    type: CREATE_CHAIN_SUCCESS,
    key: key,
    spinning: false,
    isOpen: false,
  }
}

export const createChainFailure = function (error) {
  return {
    type: CREATE_CHAIN_FAILURE,
    error: error,
    spinning: false,
    isOpen: false,
  }
}