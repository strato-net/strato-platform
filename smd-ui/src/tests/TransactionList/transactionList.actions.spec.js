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
      const chainId = "ff7ef45acb7a775018bc765b6fdeea432aaddfcd846cf6dd9442724266b1eac9";
      expect(fetchTx(last, chainId)).toMatchSnapshot();
    });

    test('success', () => {
      expect(fetchTxSuccess(transactions)).toMatchSnapshot();
    });

    test('failure', () => {
      expect(fetchTxFailure(error)).toMatchSnapshot();
    });

  });

});