import {
  updateTx,
  preloadTx,
  fetchTx,
  fetchTxSuccess,
  fetchTxFailure
} from '../../components/TransactionList/transactionList.actions';
import { transactions, updatedTransactions, last, error } from './transactionListMock';

describe('TransactionList: actions', () => {

  describe('transactions', () => {

    test('initials', () => {
      expect(updateTx(updatedTransactions)).toMatchSnapshot();
    });

    test('update', () => {
      expect(preloadTx(transactions)).toMatchSnapshot();
    });

    test('request', () => {
      expect(fetchTx(last)).toMatchSnapshot();
    });

    test('success', () => {
      expect(fetchTxSuccess(transactions)).toMatchSnapshot();
    });

    test('failure', () => {
      expect(fetchTxFailure(error)).toMatchSnapshot();
    });

  });

});