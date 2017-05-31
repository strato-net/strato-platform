export const OPEN_OVERLAY = "CONTRACT_OPEN_MODAL";
export const CLOSE_OVERLAY = "CONTRACT_CLOSE_MODAL";
export const CREATE_CONTRACT = "CREATE_CONTRACT";
export const CREATE_CONTRACT_SUCCESS = "CREATE_CONTRACT_SUCCESS";
export const CREATE_CONTRACT_FAILURE = "CREATE_CONTRACT_FAILURE";

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

export const createContract = function(payload) {
  return {
    type: CREATE_CONTRACT,
    payload,
    spinning: true,
    isOpen: true,
  }
}

export const createContractSuccess = function(response) {
  return {
    type: CREATE_CONTRACT_SUCCESS,
    response: response,
    spinning: false,
    isOpen: false,
  }
}

export const createContractFailure = function(error) {
  return {
    type: CREATE_CONTRACT_FAILURE,
    error: error,
    spinning: false,
    isOpen: false,
  }
}