import {
  FETCH_TX,
  FETCH_TX_SUCCESS,
  FETCH_TX_FAILURE,
} from './transactions.actions';

const initialState = {
  tx: [],
  error: null,
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case FETCH_TX:
      return {
        tx: state.tx,
        error: null,
      };
    case FETCH_TX_SUCCESS:
      return {
        tx: action.tx,
        error: null,
      };
    case FETCH_TX_FAILURE:
      return {
        tx: state.tx,
        error: action.error
      };
    default:
      return state;
  }
};

export default reducer;
