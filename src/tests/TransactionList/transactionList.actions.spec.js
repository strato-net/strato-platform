import {
  updateTx,
  preloadTx,
  fetchTx,
  fetchTxSuccess,
  fetchTxFailure
} from '../../components/TransactionList/transactionList.actions';
import {data, updatedData, last, error} from './transactionListMock';

describe('Test transactionlist actions', () => {
  
    test('should create an action to load initial transactions', () => {
      expect(updateTx(updatedData)).toMatchSnapshot();
    });
  
    test('should create an action to load updated transactions', () => {
      expect(preloadTx(data)).toMatchSnapshot();
    });

    test('should create an action to load updated transactions', () => {
      expect(fetchTx(last)).toMatchSnapshot();
    });
  
    test('should create an action to load updated transactions', () => {
      expect(fetchTxSuccess(data)).toMatchSnapshot();
    });
  
    test('should create an action to load updated transactions', () => {
      expect(fetchTxFailure(error)).toMatchSnapshot();
    });
  
  });