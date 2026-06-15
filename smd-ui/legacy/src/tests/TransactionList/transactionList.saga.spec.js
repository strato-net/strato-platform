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

describe('TransactionList: sagas', () => {

  test('watch transactions', () => {
    const gen = watchFetchTx();
    expect(gen.next().value).toEqual(takeEvery(FETCH_TX, fetchTx))
    expect(gen.next().done).toBe(true);
  })

  describe('fetchTx generator', () => {

    const action = {
      type: FETCH_TX,
      last,
      chainId: "ff7ef45acb7a775018bc765b6fdeea432aaddfcd846cf6dd9442724266b1eac9"
    };

    test('inspection', () => {
      const gen = fetchTx(action);

      expect(gen.next().value).toEqual(call(getTx, action.last, action.chainId));
      expect(gen.next(transactions).value).toEqual(put(fetchTxSuccess(transactions)));
      expect(gen.throw(error).value).toEqual(put(fetchTxFailure(error)));
      expect(gen.next().done).toBe(true);
    });

    describe('call fetch transactions (success)', () => {

      test('argument last:undefined', (done) => {
        fetch.mockResponse(JSON.stringify(transactions));

        expectSaga(fetchTx, { last: undefined })
          .call.fn(getTx).put.like({ action: { type: FETCH_TX_SUCCESSFUL } })
          .run().then((result) => { done() });
      });

      test('argument last:18', (done) => {
        fetch.mockResponse(JSON.stringify(transactions));

        expectSaga(fetchTx, { last: 18 })
          .call.fn(getTx).put.like({ action: { type: FETCH_TX_SUCCESSFUL } })
          .run().then((result) => { done() });
      });
    });

    test('call fetch transactions failure', (done) => {
      fetch.mockReject(JSON.stringify(transactions))

      expectSaga(fetchTx, action.last)
        .call.fn(getTx).put.like({ action: { type: FETCH_TX_FAILED } })
        .run().then((result) => { done() });
    });

    test('fail transactions on exception', () => {
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

