export const FETCH_CHAINS_REQUEST = 'FETCH_CHAINS_REQUEST';
export const FETCH_CHAINS_SUCCESS = 'FETCH_CHAINS_SUCCESS';
export const FETCH_CHAINS_FAILED = 'FETCH_CHAINS_FAILED';
export const FETCH_CHAIN_IDS_REQUEST = 'FETCH_CHAIN_IDS_REQUEST';
export const FETCH_CHAINS_IDS_SUCCESS = 'FETCH_CHAINS_IDS_SUCCESS';
export const FETCH_CHAINS_IDS_FAILED = 'FETCH_CHAINS_IDS_FAILED';
export const CHANGE_CHAIN_FILTER = 'CHANGE_CHAIN_FILTER';
export const FETCH_CHAIN_DETAIL_REQUEST = 'FETCH_CHAIN_DETAIL_REQUEST';
export const FETCH_CHAIN_DETAIL_SUCCESS = 'FETCH_CHAIN_DETAIL_SUCCESS';
export const FETCH_CHAIN_DETAIL_FAILURE = 'FETCH_CHAIN_DETAIL_FAILURE';
export const RESET_CHAIN_ID = 'RESET_CHAIN_ID';
export const RESET_INITIAL_LABLE = 'RESET_INITIAL_LABLE';

export const fetchChains = function () {
  return {
    type: FETCH_CHAINS_REQUEST
  }
};

export const fetchChainsSuccess = function (chainLabelIds) {
  return {
    type: FETCH_CHAINS_SUCCESS,
    chainLabelIds: chainLabelIds,
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

export const resetChainId = function (label) {
  return {
    type: RESET_CHAIN_ID,
    label: label
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

export const resetInitailLabel = function () {
  return {
    type: RESET_INITIAL_LABLE
  }
};

export const fetchChainIds = function () {
  return {
    type: FETCH_CHAIN_IDS_REQUEST
  }
};

export const fetchChainIdsSuccess = function (chain) {
  return {
    type: FETCH_CHAINS_IDS_SUCCESS,
    chain
  }
};

export const fetchChainIdsFailure = function (error) {
  return {
    type: FETCH_CHAINS_IDS_FAILED,
    error
  }
};