export const FETCH_CONTRACTS = 'FETCH_CONTRACTS';
export const FETCH_CONTRACTS_SUCCESSFUL = 'FETCH_CONTRACTS_SUCCESSFUL';
export const FETCH_CONTRACTS_FAILED = 'FETCH_CONTRACTS_FAILED';
export const CHANGE_CONTRACT_FILTER = 'CHANGE_CONTRACT_FILTER';
export const TOGGLE_COLLAPSE_TABLE = 'TOGGLE_COLLAPSE_TABLE';

// New actions for contract instances pagination
export const FETCH_CONTRACT_INSTANCES = 'FETCH_CONTRACT_INSTANCES';
export const FETCH_CONTRACT_INSTANCES_SUCCESS = 'FETCH_CONTRACT_INSTANCES_SUCCESS';
export const FETCH_CONTRACT_INSTANCES_FAILURE = 'FETCH_CONTRACT_INSTANCES_FAILURE';

export const fetchContracts = function (chainId, limit, offset, name, instancesPreviewLimit = 10) {
  return {
    type: FETCH_CONTRACTS,
    chainId,
    limit,
    offset,
    name,
    instancesPreviewLimit
  }
};

// New action creators for contract instances pagination
export const fetchContractInstances = function (contractName, chainId, instOffset = 0, instLimit = 10) {
  return {
    type: FETCH_CONTRACT_INSTANCES,
    contractName,
    chainId,
    instOffset,
    instLimit
  }
};

export const fetchContractInstancesSuccess = function (contractName, instances) {
  return {
    type: FETCH_CONTRACT_INSTANCES_SUCCESS,
    contractName,
    instances
  }
};

export const fetchContractInstancesFailure = function (contractName, error) {
  return {
    type: FETCH_CONTRACT_INSTANCES_FAILURE,
    contractName,
    error
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
