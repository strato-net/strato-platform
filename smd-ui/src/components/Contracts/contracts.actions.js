export const FETCH_CONTRACTS = 'FETCH_CONTRACTS';
export const FETCH_CONTRACTS_SUCCESSFUL = 'FETCH_CONTRACTS_SUCCESSFUL';
export const FETCH_CONTRACTS_FAILED = 'FETCH_CONTRACTS_FAILED';
export const CHANGE_CONTRACT_FILTER = 'CHANGE_CONTRACT_FILTER';
export const TOGGLE_COLLAPSE_TABLE = 'TOGGLE_COLLAPSE_TABLE';

// New pagination actions
export const FETCH_CONTRACTS_WITH_PREVIEW = 'FETCH_CONTRACTS_WITH_PREVIEW';
export const FETCH_CONTRACTS_WITH_PREVIEW_SUCCESS = 'FETCH_CONTRACTS_WITH_PREVIEW_SUCCESS';
export const FETCH_CONTRACTS_WITH_PREVIEW_FAILED = 'FETCH_CONTRACTS_WITH_PREVIEW_FAILED';
export const LOAD_MORE_CONTRACTS = 'LOAD_MORE_CONTRACTS';
export const LOAD_MORE_CONTRACTS_SUCCESS = 'LOAD_MORE_CONTRACTS_SUCCESS';
export const LOAD_MORE_INSTANCES = 'LOAD_MORE_INSTANCES';
export const LOAD_MORE_INSTANCES_SUCCESS = 'LOAD_MORE_INSTANCES_SUCCESS';
export const LOAD_MORE_INSTANCES_FAILED = 'LOAD_MORE_INSTANCES_FAILED';

export const fetchContracts = function (chainId, limit, offset, name) {
  return {
    type: FETCH_CONTRACTS,
    chainId,
    limit,
    offset,
    name
  }
};

export const fetchContractsSuccess = function (contracts) {
  return {
    type: FETCH_CONTRACTS_SUCCESSFUL,
    contracts: contracts
  }
};

export const fetchContractsFailure = function (error) {
  return {
    type: FETCH_CONTRACTS_FAILED,
    error: error,
  }
};

export const changeContractFilter = function (filter) {
  return {
    type: CHANGE_CONTRACT_FILTER,
    filter: filter,
  }
};

// New pagination action creators
export const fetchContractsWithPreview = function (chainId, limit, offset, name, address, instancesPreviewLimit) {
  return {
    type: FETCH_CONTRACTS_WITH_PREVIEW,
    chainId,
    limit,
    offset,
    name,
    address,
    instancesPreviewLimit
  }
};

export const fetchContractsWithPreviewSuccess = function (response) {
  return {
    type: FETCH_CONTRACTS_WITH_PREVIEW_SUCCESS,
    contracts: response.contracts || {},
    __next: response.__next || {},
    isInitialLoad: true
  }
};

export const fetchContractsWithPreviewFailed = function (error) {
  return {
    type: FETCH_CONTRACTS_WITH_PREVIEW_FAILED,
    error: error,
  }
};

export const loadMoreContracts = function (chainId, offset, limit, name, instancesPreviewLimit) {
  return {
    type: LOAD_MORE_CONTRACTS,
    chainId,
    offset,
    limit,
    name,
    instancesPreviewLimit
  }
};

export const loadMoreContractsSuccess = function (response) {
  return {
    type: LOAD_MORE_CONTRACTS_SUCCESS,
    contracts: response.contracts || {},
    __next: response.__next || {},
    isInitialLoad: false
  }
};

export const loadMoreInstances = function (contractName, instOffset, instLimit, chainId) {
  return {
    type: LOAD_MORE_INSTANCES,
    contractName,
    instOffset,
    instLimit,
    chainId
  }
};

export const loadMoreInstancesSuccess = function (contractName, instances, nextOffset) {
  return {
    type: LOAD_MORE_INSTANCES_SUCCESS,
    contractName,
    instances,
    nextOffset
  }
};

export const loadMoreInstancesFailed = function (contractName, error) {
  return {
    type: LOAD_MORE_INSTANCES_FAILED,
    contractName,
    error
  }
};
