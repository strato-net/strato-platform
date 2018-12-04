export const SELECT_CONTRACT_INSTANCE = 'SELECT_CONTRACT_INSTANCE';
export const FETCH_STATE_REQUEST = 'FETCH_STATE_REQUEST';
export const FETCH_STATE_SUCCESS = 'FETCH_STATE_SUCCESS';
export const FETCH_STATE_FAILURE = 'FETCH_STATE_FAILURE';
export const FETCH_CIRRUS_INSTANCES_REQUEST = 'FETCH_CIRRUS_INSTANCES_REQUEST';
export const FETCH_CIRRUS_INSTANCES_SUCCESS = 'FETCH_CIRRUS_INSTANCES_SUCCESS';
export const FETCH_CIRRUS_INSTANCES_FAILURE = 'FETCH_CIRRUS_INSTANCES_FAILURE';
export const FETCH_ACCOUNT_REQUEST = 'FETCH_ACCOUNT_REQUEST';
export const FETCH_ACCOUNT_SUCCESS = 'FETCH_ACCOUNT_SUCCESS';
export const FETCH_ACCOUNT_FAILURE = 'FETCH_ACCOUNT_FAILURE';

export const fetchState = function (name, address, chainId) {
  return {
    type: FETCH_STATE_REQUEST,
    name: name,
    address: address,
    chainId: chainId
  }
};

export const fetchStateSuccess = function (name, address, state) {
  return {
    type: FETCH_STATE_SUCCESS,
    name: name,
    address: address,
    state: state,
  }
};

export const fetchStateFailure = function (error) {
  return {
    type: FETCH_STATE_FAILURE,
    error: error,
  }
};

export const selectContractInstance = function(name, address) {
  return {
    type: SELECT_CONTRACT_INSTANCE,
    name,
    address
  }
}

export const fetchCirrusInstances = function (contractName) {
  return {
    type: FETCH_CIRRUS_INSTANCES_REQUEST,
    name: contractName
  }
};

export const fetchCirrusInstancesSuccess = function (contractName, instances) {
  return {
    type: FETCH_CIRRUS_INSTANCES_SUCCESS,
    name: contractName,
    instances: instances
  }
};

export const fetchCirrusInstancesFailure = function (contractName, error) {
  return {
    type: FETCH_CIRRUS_INSTANCES_FAILURE,
    name: contractName,
    error: error,
  }
};

export const fetchAccount = function (contractName, contractAddress) {
  return {
    type: FETCH_ACCOUNT_REQUEST,
    name: contractName,
    address: contractAddress
  }
}

export const fetchAccountSuccess = function (contractName, contractAddress, account) {
  return {
    type: FETCH_ACCOUNT_SUCCESS,
    name: contractName,
    address: contractAddress,
    account
  }
}

export const fetchAccountFailure = function (contractName, contractAddress, error) {
  return {
    type: FETCH_ACCOUNT_FAILURE,
    name: contractName,
    address: contractAddress,
    error: error
  }
}