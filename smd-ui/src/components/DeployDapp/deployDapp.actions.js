export const DEPLOY_DAPP_OPEN_MODAL = "DEPLOY_DAPP_OPEN_MODAL";
export const DEPLOY_DAPP_CLOSE_MODAL = "DEPLOY_DAPP_CLOSE_MODAL";
export const OPEN_OVERLAY = "OPEN_CHAIN_MODAL";
export const CLOSE_OVERLAY = "CLOSE_CHAIN_MODAL";
export const OPEN_ADD_MEMBER_MODAL = "OPEN_ADD_MEMBER_MODAL";
export const CLOSE_ADD_MEMBER_MODAL = "CLOSE_ADD_MEMBER_MODAL";
export const OPEN_ADD_INTEGRATION_MODAL = "OPEN_ADD_INTEGRATION_MODAL";
export const CLOSE_ADD_INTEGRATION_MODAL = "CLOSE_ADD_INTEGRATION_MODAL";
export const DEPLOY_DAPP_REQUEST = "DEPLOY_DAPP_REQUEST";
export const DEPLOY_DAPP_SUCCESS = "DEPLOY_DAPP_SUCCESS";
export const DEPLOY_DAPP_FAILURE = "DEPLOY_DAPP_FAILURE";
export const COMPILE_CONTRACT_REQUEST = "COMPILE_CONTRACT_REQUEST";
export const COMPILE_CONTRACT_SUCCESS = "COMPILE_CONTRACT_SUCCESS";
export const COMPILE_CONTRACT_FAILURE = "COMPILE_CONTRACT_FAILURE";
export const USERNAME_FORM_CHANGE = "USERNAME_FORM_CHANGE";
export const CONTRACT_FORM_CHANGE = "CONTRACT_UPLOAD_FORM_CHANGE";
export const CHAIN_NAME_CHANGE = "CHAIN_NAME_CHANGE";
export const UPDATE_TOAST = "UPDATE_TOAST";
export const RESET_ERROR = "RESET_ERROR";

export const contractFormChange = function(contract) {
  return {
    type : CONTRACT_FORM_CHANGE,
    contract: contract
  }
}

export const chainNameChange = function(chainName) {
  return {
    type: CHAIN_NAME_CHANGE,
    chainName: chainName
  }
}

export const usernameChange = function(name) {
  return {
    type: USERNAME_FORM_CHANGE,
    name: name
  }
}

export const deployDappOpenModal = function() {
  return {
    type: DEPLOY_DAPP_OPEN_MODAL,
    isOpen: true
  }
}

export const deployDappCloseModal = function() {
  return {
    type: DEPLOY_DAPP_CLOSE_MODAL,
    isOpen: false
  }
}

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

export const openAddIntegrationModal = function () {
  return {
    type: OPEN_ADD_INTEGRATION_MODAL,
    isOpen: true
  }
}

export const closeAddIntegrationModal = function () {
  return {
    type: CLOSE_ADD_INTEGRATION_MODAL,
    isOpen: false
  }
}

export const deployDapp = function (label, members, balances, integrations, src, contract, args, vm) {
  return {
    type: DEPLOY_DAPP_REQUEST,
    label,
    members,
    balances,
    integrations,
    src,
    contract,
    args,
    vm,
    spinning: true,
    isOpen: true,
  }
}

export const deployDappSuccess = function(response) {
  return {
    type: DEPLOY_DAPP_SUCCESS,
    response: response,
    spinning: false,
    isOpen: true,
    toasts: true,
    toastsMessage: response && response.status ? 'DApp Deployed' : response
  }
}

export const updateToast = function() {
  return {
    type: 'UPDATE_TOAST',
    toasts: false,
    toastsMessage: ''
  }
}

export const deployDappFailure = function(error) {
  return {
    type: DEPLOY_DAPP_FAILURE,
    error,
    spinning: false,
    isOpen: false,
    toasts: true,
    toastsMessage: `DApp deployment failed: ${error}`
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
