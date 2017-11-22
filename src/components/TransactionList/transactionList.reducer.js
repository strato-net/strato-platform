import {
  FETCH_TX,
  FETCH_TX_SUCCESSFUL,
  FETCH_TX_FAILED,
  UPDATE_TX,
  PRELOAD_TX
} from './transactionList.actions';

const initialState = {
  tx: [],
  transactions: [],
  error: null,
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case UPDATE_TX:
    console.log('Update TX Data:',action)
      return {
        transactions: action.data,
      }

    case PRELOAD_TX:
    console.log('Preload TX Data:', action)
      return {
        transactions: action.data,
      }
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
