import watchFetchTx, {
  fetchTx,
  getTx
} from '../../components/TransactionList/transactionList.saga';
import {
  takeEvery,
  call,
  put
} from 'redux-saga/effects';
import {
  FETCH_TX,
  fetchTxSuccess,
  FETCH_TX_SUCCESSFUL,
  fetchTxFailure,
  FETCH_TX_FAILED
} from '../../components/TransactionList/transactionList.actions';
import { expectSaga } from 'redux-saga-test-plan';
import { transactions, last, error } from './transactionListMock'

describe('Test transactions saga', () => {

  test('should watch transactions', () => {
    const gen = watchFetchTx();
    expect(gen.next().value).toEqual(takeEvery(FETCH_TX, fetchTx))
  })

  describe('fetchTx generator', () => {

    const action = {
      type: FETCH_TX,
      last
    };

    test('inspection', () => {
      const gen = fetchTx(action);

      expect(gen.next().value).toEqual(call(getTx, action.last));
      expect(gen.next(transactions).value).toEqual(put(fetchTxSuccess(transactions)));
      expect(gen.throw(error).value).toEqual(put(fetchTxFailure(error)));
      expect(gen.next().done).toBe(true);
    });

    test('should call fetch transactions with success', (done) => {
      fetch.mockResponse(JSON.stringify(transactions));

      expectSaga(fetchTx, action.last)
        .call.fn(getTx).put.like({ action: { type: FETCH_TX_SUCCESSFUL } })
        .run().then((result) => { done() });
    });

    test('should call fetch transactions failure', (done) => {
      fetch.mockReject(JSON.stringify(transactions))

      expectSaga(fetchTx, action.last)
        .call.fn(getTx).put.like({ action: { type: FETCH_TX_FAILED } })
        .run().then((result) => { done() });
    });

    test('should fail transactions on exception', () => {
      expectSaga(fetchTx, action.last)
        .provide({
          call() {
            throw new Error('Not Found');
          },
        })
        .put.like({ action: { type: FETCH_TX_FAILED } })
        .run();
    });

  });

});

