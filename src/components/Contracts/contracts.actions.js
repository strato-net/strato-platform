export const FETCH_CONTRACTS = 'FETCH_CONTRACTS';
export const FETCH_CONTRACTS_SUCCESS = 'FETCH_CONTRACTS_SUCCESS';
export const FETCH_CONTRACTS_FAILURE = 'FETCH_CONTRACTS_FAILURE';
export const CHANGE_CONTRACT_FILTER = 'CHANGE_CONTRACT_FILTER';

export const fetchContracts = function () {
  return {
    type: FETCH_CONTRACTS,
  }
};

export const fetchContractsSuccess = function (res) {
  return {
    type: FETCH_CONTRACTS_SUCCESS,
    contracts: res
  }
};

export const fetchContractsFailure = function (error) {
  return {
    type: FETCH_CONTRACTS_FAILURE,
    error: error,
  }
};

export const changeContractFilter = function (filter) {
  return {
    type: CHANGE_CONTRACT_FILTER,
    filter: filter,
  }
}
