import {
  FETCH_TX,
  FETCH_TX_SUCCESSFUL,
  FETCH_TX_FAILED,
} from './transactionList.actions';

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
    case FETCH_TX_SUCCESSFUL:
      return {
        tx: action.tx,
        error: null,
      };
    case FETCH_TX_FAILED:
      return {
        tx: state.tx,
        error: action.error
      };
    default:
      return state;
  }
};

export default reducer;
