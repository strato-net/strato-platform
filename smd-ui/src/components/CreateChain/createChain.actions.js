export const OPEN_OVERLAY = "OPEN_CHAIN_MODAL";
export const CLOSE_OVERLAY = "CLOSE_CHAIN_MODAL";
export const OPEN_ADD_MEMBER_MODAL = "OPEN_ADD_MEMBER_MODAL";
export const CLOSE_ADD_MEMBER_MODAL = "CLOSE_ADD_MEMBER_MODAL";
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

export const openAddMemberModal = function () {
  return {
    type: OPEN_ADD_MEMBER_MODAL,
    isOpen: true
  }
}

export const closeAddMemberModal = function () {
  return {
    type: CLOSE_ADD_MEMBER_MODAL,
    isOpen: false
  }
}

export const createChain = function (label, members, balances, src, args) {
  return {
    type: CREATE_CHAIN_REQUEST,
    label,
    members,
    balances,
    src,
    args,
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