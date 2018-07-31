export const FETCH_CHAINS = 'FETCH_CHAINS';
export const FETCH_CHAINS_SUCCESSFULL = 'FETCH_CHAINS_SUCCESSFULL';
export const FETCH_CHAINS_FAILED = 'FETCH_CHAINS_FAILED';
export const CHANGE_CHAIN_FILTER = 'CHANGE_CHAIN_FILTER';
export const RESET_CHAIN_ID = 'RESET_CHAIN_ID';

export const fetchChains = function (loadLabels, loadDetails) {
  return {
    type: FETCH_CHAINS,
    loadLabels: loadLabels,
    loadDetails: loadDetails
  }
};

export const fetchChainsSuccess = function (chainLabels, chainIds, chainInfos) {
  return {
    type: FETCH_CHAINS_SUCCESSFULL,
    chainLabels: chainLabels,
    chainIds: chainIds,
    chainInfos: chainInfos
  }
};

export const fetchChainsFailure = function (error) {
  return {
    type: FETCH_CHAINS_FAILED,
    error: error,
  }
};

export const changeChainFilter = function (filter) {
  return {
    type: CHANGE_CHAIN_FILTER,
    filter: filter
  }
};

export const resetChainId = function (name) {
  return {
    type: RESET_CHAIN_ID,
    name: name
  }
};