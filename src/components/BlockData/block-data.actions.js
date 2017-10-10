export const FETCH_BLOCK_DATA = 'FETCH_BLOCK_DATA';
export const FETCH_BLOCK_DATA_SUCCESSFUL = 'FETCH_BLOCK_DATA_SUCCESSFUL';
export const FETCH_BLOCK_DATA_FAILED = 'FETCH_BLOCK_DATA_FAILED';

export const fetchBlockData = function () {
  return {
    type: FETCH_BLOCK_DATA,
  }
};

export const fetchBlockDataSuccess = function (blockData) {
  return {
    type: FETCH_BLOCK_DATA_SUCCESSFUL,
    blockData: blockData
  }
};

export const fetchBlockDataFailure = function (error) {
  return {
    type: FETCH_BLOCK_DATA_FAILED,
    error: error,
  }
};
