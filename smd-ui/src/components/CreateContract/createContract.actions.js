export const CONTRACT_OPEN_MODAL = "CONTRACT_OPEN_MODAL";
export const CONTRACT_CLOSE_MODAL = "CONTRACT_CLOSE_MODAL";
export const CREATE_CONTRACT_REQUEST = "CREATE_CONTRACT_REQUEST";
export const CREATE_CONTRACT_SUCCESS = "CREATE_CONTRACT_SUCCESS";
export const CREATE_CONTRACT_FAILURE = "CREATE_CONTRACT_FAILURE";
export const COMPILE_CONTRACT_REQUEST = "COMPILE_CONTRACT_REQUEST";
export const COMPILE_CONTRACT_SUCCESS = "COMPILE_CONTRACT_SUCCESS";
export const COMPILE_CONTRACT_FAILURE = "COMPILE_CONTRACT_FAILURE";
export const USERNAME_FORM_CHANGE = "USERNAME_FORM_CHANGE";
export const CONTRACT_FORM_CHANGE = "CONTRACT_UPLOAD_FORM_CHANGE";
export const CONTRACT_NAME_CHANGE = "CONTRACT_NAME_CHANGE";
export const UPDATE_TOAST = "UPDATE_TOAST";
export const RESET_ERROR = "RESET_ERROR";
export const UPDATE_USING_SAMPLE_CONTRACT = "UPDATE_USING_SAMPLE_CONTRACT"

export const contractFormChange = function(contract) {
  return {
    type : CONTRACT_FORM_CHANGE,
    contract: contract
  }
}

export const contractNameChange = function(contractName) {
  return {
    type: CONTRACT_NAME_CHANGE,
    contractName: contractName
  }
}

export const usernameChange = function(name) {
  return {
    type: USERNAME_FORM_CHANGE,
    name: name
  }
}

export const contractOpenModal = function() {
  return {
    type: CONTRACT_OPEN_MODAL,
    isOpen: true
  }
}

export const contractCloseModal = function() {
  return {
    type: CONTRACT_CLOSE_MODAL,
    isOpen: false
  }
}

export const createContract = function(payload) {
  return {
    type: CREATE_CONTRACT_REQUEST,
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
    toasts: true,
    toastsMessage: response && response.status ? 'Contract Created' : response
  }
}

export const updateToast = function() {
  return {
    type: 'UPDATE_TOAST',
    toasts: false,
    toastsMessage: ''
  }
}

export const createContractFailure = function(error) {
  return {
    type: CREATE_CONTRACT_FAILURE,
    error,
    spinning: false,
    isOpen: false,
    toasts: true,
    toastsMessage: `Contract creation failed: ${error}`
  }
}

export const compileContract = function(name, contract, solidvm) {
  return {
    type: COMPILE_CONTRACT_REQUEST,
    name: name,
    contract: contract,
    solidvm: solidvm,
    isOpen: true,
  }
}

export const compileContractSuccess = function(response) {
  return {
    type: COMPILE_CONTRACT_SUCCESS,
    response: response,
    isOpen: true,
  }
}

export const compileContractFailure = function(error) {
  return {
    type: COMPILE_CONTRACT_FAILURE,
    error: error,
    isOpen: false,
  }
}

export const resetError = function() {
  return {
    type: RESET_ERROR
  }
}

export const updateUsingSampleContract = function(status) {
  return {
    type: UPDATE_USING_SAMPLE_CONTRACT,
    usingSampleContract: status,
  }
}
