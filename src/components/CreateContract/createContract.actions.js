export const OPEN_OVERLAY = "CONTRACT_OPEN_MODAL";
export const CLOSE_OVERLAY = "CONTRACT_CLOSE_MODAL";
export const CREATE_CONTRACT = "CREATE_CONTRACT";
export const CREATE_CONTRACT_SUCCESS = "CREATE_CONTRACT_SUCCESS";
export const CREATE_CONTRACT_FAILURE = "CREATE_CONTRACT_FAILURE";
export const COMPILE_CONTRACT = "COMPILE_CONTRACT";
export const COMPILE_CONTRACT_SUCCESS = "COMPILE_CONTRACT_SUCCESS";
export const COMPILE_CONTRACT_FAILURE = "COMPILE_CONTRACT_FAILURE";

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
    isOpen: true,
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

export const compileContract = function(payload) {
  return {
    type: COMPILE_CONTRACT,
    payload,
    compileSuccess: false,
    isOpen: true,
  }
}

export const compileContractSuccess = function(response) {
  return {
    type: COMPILE_CONTRACT_SUCCESS,
    response: response,
    compileSuccess: false,
    isOpen: true,
  }
}

export const compileContractFailure = function(error) {
  return {
    type: COMPILE_CONTRACT_FAILURE,
    error: error,
    compileSuccess: false,
    isOpen: false,
  }
}