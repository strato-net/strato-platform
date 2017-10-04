export const FETCH_BLOCK_DATA_REQUEST = 'FETCH_BLOCK_DATA_REQUEST';
export const FETCH_BLOCK_DATA_SUCCESS = 'FETCH_BLOCK_DATA_SUCCESS';
export const FETCH_BLOCK_DATA_FAILURE = 'FETCH_BLOCK_DATA_FAILURE';

export const fetchBlockData = function () {
  return {
    type: FETCH_BLOCK_DATA_REQUEST,
  }
};

export const fetchBlockDataSuccess = function (blockData) {
  return {
    type: FETCH_BLOCK_DATA_SUCCESS,
    blockData: blockData
  }
};

export const fetchBlockDataFailure = function (error) {
  return {
    type: FETCH_BLOCK_DATA_FAILURE,
    error: error,
  }
};
