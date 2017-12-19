import {
  updateTx,
  preloadTx,
  fetchTx,
  fetchTxSuccess,
  fetchTxFailure
} from '../../components/TransactionList/transactionList.actions';
import { transactions, updatedTransactions, last, error } from './transactionListMock';

describe('Test transactionlist actions', () => {

  test('should create an action to load initial transactions', () => {
    expect(updateTx(updatedTransactions)).toMatchSnapshot();
  });

  test('should create an action to load updated transactions', () => {
    expect(preloadTx(transactions)).toMatchSnapshot();
  });

  test('should create an action to load updated transactions', () => {
    expect(fetchTx(last)).toMatchSnapshot();
  });

  test('should create an action to load updated transactions', () => {
    expect(fetchTxSuccess(transactions)).toMatchSnapshot();
  });

  test('should create an action to load updated transactions', () => {
    expect(fetchTxFailure(error)).toMatchSnapshot();
  });

});