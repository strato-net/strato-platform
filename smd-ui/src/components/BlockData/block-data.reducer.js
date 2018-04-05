import {
  FETCH_BLOCK_DATA,
  FETCH_BLOCK_DATA_SUCCESSFUL,
  FETCH_BLOCK_DATA_FAILED,
} from './block-data.actions';

const initialState = {
  blockData: [],
  error: null,
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case FETCH_BLOCK_DATA:
      return {
        blockData: state.blockData,
        error: null,
      };
    case FETCH_BLOCK_DATA_SUCCESSFUL:
      return {
        blockData: action.blockData,
        error: null,
      };
    case FETCH_BLOCK_DATA_FAILED:
      return {
        blockData: state.blockData,
        error: action.error
      };
    default:
      return state;
  }
};

export default reducer;
