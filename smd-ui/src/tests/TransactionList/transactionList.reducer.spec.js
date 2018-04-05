import reducer from '../../components/TransactionList/transactionList.reducer';
import { transactions, updatedTransactions, last, error } from "./transactionListMock";
import {
  updateTx,
  preloadTx,
  UPDATE_TX,
  PRELOAD_TX,
  fetchTx,
  fetchTxSuccess,
  fetchTxFailure
} from '../../components/TransactionList/transactionList.actions';
import { deepClone } from '../helper/testHelper';

describe('TransactionList: reducer', () => {

  // INITIAL_STATE
  test('set initial state', () => {
    expect(reducer(undefined, {})).toMatchSnapshot();
  });

  describe('transactions', () => {

    // UPDATE_TX
    test('update', () => {
      const action = preloadTx(transactions);
      const initialState = {
        tx: [],
        transactions: [],
        error: null,
      }
      expect(reducer(initialState, action)).toMatchSnapshot();
    })

    // PRELOAD_TX
    test('load', () => {
      const action = updateTx(updatedTransactions);
      const initialState = {
        tx: [],
        transactions: transactions,
        error: null,
      }
      expect(reducer(initialState, action)).toMatchSnapshot();
    })

    // FETCH_TX
    test('request', () => {
      const action = fetchTx(last);
      const initialState = {
        tx: [],
        transactions: [],
        error: null
      }
      expect(reducer(initialState, action)).toMatchSnapshot();
    })

    // FETCH_TX_SUCCESSFUL
    test('success', () => {
      const action = fetchTxSuccess(transactions);
      const initialState = {
        tx: [],
        transactions: [],
        error: null
      }
      expect(reducer(initialState, action)).toMatchSnapshot();
    })

    // FETCH_TX_FAILED
    test('failure', () => {
      const action = fetchTxFailure(error);
      const initialState = {
        tx: [],
        transactions: [],
        error: null
      }
      expect(reducer(initialState, action)).toMatchSnapshot();
    });
  });
});
