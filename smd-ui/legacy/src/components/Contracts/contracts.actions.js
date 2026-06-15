export const FETCH_CONTRACTS = 'FETCH_CONTRACTS';
export const FETCH_CONTRACTS_SUCCESSFUL = 'FETCH_CONTRACTS_SUCCESSFUL';
export const FETCH_CONTRACTS_FAILED = 'FETCH_CONTRACTS_FAILED';
export const CHANGE_CONTRACT_FILTER = 'CHANGE_CONTRACT_FILTER';
export const TOGGLE_COLLAPSE_TABLE = 'TOGGLE_COLLAPSE_TABLE';

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
