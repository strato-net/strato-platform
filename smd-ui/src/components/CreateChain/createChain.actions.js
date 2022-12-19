export const OPEN_OVERLAY = "OPEN_CHAIN_MODAL";
export const CLOSE_OVERLAY = "CLOSE_CHAIN_MODAL";
export const OPEN_ADD_MEMBER_MODAL = "OPEN_ADD_MEMBER_MODAL";
export const CLOSE_ADD_MEMBER_MODAL = "CLOSE_ADD_MEMBER_MODAL";
export const OPEN_ADD_INTEGRATION_MODAL = "OPEN_ADD_INTEGRATION_MODAL";
export const CLOSE_ADD_INTEGRATION_MODAL = "CLOSE_ADD_INTEGRATION_MODAL";
export const CREATE_CHAIN_REQUEST = "CREATE_CHAIN_REQUEST";
export const CREATE_CHAIN_SUCCESS = "CREATE_CHAIN_SUCCESS";
export const CREATE_CHAIN_FAILURE = "CREATE_CHAIN_FAILURE";
export const RESET_ERROR = "RESET_ERROR";
export const COMPILE_CHAIN_CONTRACT_REQUEST = "COMPILE_CHAIN_CONTRACT_REQUEST";
export const COMPILE_CHAIN_CONTRACT_SUCCESS = "COMPILE_CHAIN_CONTRACT_SUCCESS";
export const COMPILE_CHAIN_CONTRACT_FAILURE = "COMPILE_CHAIN_CONTRACT_FAILURE";
export const RESET_CONTRACT = "RESET_CONTRACT";
export const CONTRACT_NAME_CHANGE = "CONTRACT_NAME_CHANGE";

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

export const createChain = function (label, members, balances, integrations, src, args, vm, contractName, limit, offset) {
  return {
    type: CREATE_CHAIN_REQUEST,
    label,
    members,
    balances,
    integrations,
    src,
    args,
    vm,
    spinning: true,
    isOpen: true,
    contractName,
    limit,
    offset,
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

export const resetError = function () {
  return {
    type: RESET_ERROR
  }
}

export const compileChainContract = function (name, contract, searchable, vm) {
  return {
    type: COMPILE_CHAIN_CONTRACT_REQUEST,
    name: name,
    contract: contract,
    searchable: searchable,
    vm,
  }
}

export const compileChainContractSuccess = function (response) {
  return {
    type: COMPILE_CHAIN_CONTRACT_SUCCESS,
    response
  }
}

export const compileChainContractFailure = function (error) {
  return {
    type: COMPILE_CHAIN_CONTRACT_FAILURE,
    error
  }
}

export const resetContract = function () {
  return {
    type: RESET_CONTRACT
  }
}

export const contractNameChange = function(contractName) {
  return {
    type: CONTRACT_NAME_CHANGE,
    contractName
  }
}