export const FETCH_CHAINS = 'FETCH_CHAINS';
export const FETCH_CHAINS_SUCCESSFULL = 'FETCH_CHAINS_SUCCESSFULL';
export const FETCH_CHAINS_FAILED = 'FETCH_CHAINS_FAILED';
export const CHANGE_CHAIN_FILTER = 'CHANGE_CHAIN_FILTER';
export const RESET_CHAIN_ID = 'RESET_CHAIN_ID';
export const FETCH_CHAIN_DETAIL_REQUEST = 'FETCH_CHAIN_DETAIL_REQUEST';
export const FETCH_CHAIN_DETAIL_SUCCESS = 'FETCH_CHAIN_DETAIL_SUCCESS';
export const FETCH_CHAIN_DETAIL_FAILURE = 'FETCH_CHAIN_DETAIL_FAILURE';

export const fetchChains = function (loadLabels, loadDetails) {
  return {
    type: FETCH_CHAINS,
    loadLabels: loadLabels,
    loadDetails: loadDetails
  }
};

export const fetchChainsSuccess = function (chainLabels, chainIds) {
  return {
    type: FETCH_CHAINS_SUCCESSFULL,
    chainLabels: chainLabels,
    chainIds: chainIds
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
}

export const fetchChainDetail = function (label, id) {
  return {
    type: FETCH_CHAIN_DETAIL_REQUEST,
    label: label,
    id: id
  }
};

export const fetchChainDetailSuccess = function (label, id, detail) {
  return {
    type: FETCH_CHAIN_DETAIL_SUCCESS,
    label: label,
    id: id,
    detail: detail
  }
};

export const fetchChainDetailFailure = function (label, id, error) {
  return {
    type: FETCH_CHAIN_DETAIL_FAILURE,
    label: label,
    id: id,
    error: error
  }
};