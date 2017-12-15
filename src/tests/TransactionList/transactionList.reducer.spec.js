import reducer from '../../components/TransactionList/transactionList.reducer';
import { data, updatedData } from "./transactionListMock";
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

describe('Test transaction list reducer', () => {

  // INITIAL_STATE
  test('should set initial state', () => {
    expect(reducer(undefined, {})).toMatchSnapshot();
  });

  // UPDATE_TX
  test('should store initial transactions', () => {
    const action = preloadTx(data);
    const initialState = {
      tx: [],
      transactions: [],
      error: null,
    }
    expect(reducer(initialState, action)).toMatchSnapshot();
  })

  // PRELOAD_TX
  test('should store updated transactions', () => {
    const action = updateTx(updatedData);
    const initialState = {
      tx: [],
      transactions: data,
      error: null,
    }
    expect(reducer(initialState, action)).toMatchSnapshot();
  })

  // FETCH_TX
  test('should fetch transactions', () => {
    const action = fetchTx(last);
    const initialState = {
      tx: [],
      transactions: [],
      error: null
    }
    expect(reducer(initialState, action)).toMatchSnapshot();
  })

  // FETCH_TX_SUCCESSFUL
  test('should store transactions on FETCH_TX', () => {
    const action = fetchTxSuccess(data);
    const initialState = {
      tx: [],
      transactions: [],
      error: null
    }
    expect(reducer(initialState, action)).toMatchSnapshot();
  })

  // FETCH_TX_FAILED
  test('should store error on FETCH_TX failure', () => {
    const action = fetchTxFailure(error);
    const initialState = {
      tx: [],
      transactions: [],
      error: null
    }
    expect(reducer(initialState, action)).toMatchSnapshot();
  })

})
