import {
  FETCH_BLOCK_DATA_REQUEST,
  FETCH_BLOCK_DATA_SUCCESS,
  FETCH_BLOCK_DATA_FAILURE,
} from './block-data.actions';

const initialState = {
  blockData: [],
  error: null,
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case FETCH_BLOCK_DATA_REQUEST:
      return {
        blockData: state.blockData,
        error: null,
      };
    case FETCH_BLOCK_DATA_SUCCESS:
      return {
        blockData: action.blockData,
        error: null,
      };
    case FETCH_BLOCK_DATA_FAILURE:
      return {
        blockData: state.blockData,
        error: action.error
      };
    default:
      return state;
  }
};

export default reducer;
