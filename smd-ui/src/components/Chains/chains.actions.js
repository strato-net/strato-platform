export const FETCH_CHAINS = 'FETCH_CHAINS';
export const FETCH_CHAINS_SUCCESSFULL = 'FETCH_CHAINS_SUCCESSFULL';
export const FETCH_CHAINS_FAILED = 'FETCH_CHAINS_FAILED';
export const CHANGE_CHAIN_FILTER = 'CHANGE_CHAIN_FILTER';
export const FETCH_CHAIN_ID_REQUEST = 'FETCH_CHAIN_ID_REQUEST';
export const FETCH_CHAIN_ID_SUCCESSFUL = 'FETCH_CHAIN_ID_SUCCESS';
export const FETCH_CHAIN_ID_FAILED = 'FETCH_CHAIN_ID_FAILURE';
export const FETCH_CHAIN_DETAIL_REQUEST = 'FETCH_CHAIN_DETAIL_REQUEST';
export const FETCH_CHAIN_DETAIL_SUCCESS = 'FETCH_CHAIN_DETAIL_SUCCESS';
export const FETCH_CHAIN_DETAIL_FAILURE = 'FETCH_CHAIN_DETAIL_FAILURE';
export const RESET_CHAIN_ID = 'RESET_CHAIN_ID';

export const fetchChains = function (loadLabels, loadChainId) {
  return {
    type: FETCH_CHAINS,
    loadLabels: loadLabels,
    loadChainId: loadChainId
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

export const fetchChainId = function (label, labelList, idList, loadDetails) {
  return {
    type: FETCH_CHAIN_ID_REQUEST,
    label: label,
    labelList: labelList,
    idList: idList,
    loadDetails: loadDetails
  }
};

export const resetChainId = function (label) {
  return {
    type: RESET_CHAIN_ID,
    label: label
  }
};

export const fetchChainIdSuccess = function (label, id) {
  return {
    type: FETCH_CHAIN_ID_SUCCESSFUL,
    label: label,
    id: id
  }
};

export const fetchChainIdFailure = function (label, error) {
  return {
    type: FETCH_CHAIN_ID_FAILED,
    label: label,
    error: error
  }
};

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