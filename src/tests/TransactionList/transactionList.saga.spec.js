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
  FETCH_TX_SUCCESSFUL,
  fetchTxSuccess,
  fetchTxFailure
} from '../../components/TransactionList/transactionList.actions';
import { expectSaga } from 'redux-saga-test-plan';
import { data, updatedData, last, error } from './transactionListMock'

describe('Test transactions saga', () => {

  test('should watch transactions', () => {
    const gen = watchFetchTx();
    expect(gen.next().value).toEqual(takeEvery(FETCH_TX, fetchTx))
  })

  test('should check the fetch transactions api', () => {
    const gen = fetchTx({ type: "FETCH_TX", last });
    expect(gen.next().value).toEqual(call(getTx, 15));
    expect(gen.next().value).toEqual(put({ type: FETCH_TX_SUCCESSFUL }))
  })

  test('should call fetch transactions', () => {
    fetch.mockResponse(JSON.stringify(data))
    expectSaga(fetchTx, last)
      .call.fn(getTx).put.like({ action: { type: FETCH_TX_SUCCESSFUL } })
      .run()
  });

  test('should call fetch transactions failure', () => {
    fetch.mockReject(JSON.stringify(data))
    expectSaga(fetchTx, last)
      .call.fn(getTx).put.like({ action: { type: 'FETCH_TX_FAILED' } })
      .run()
  });

  test('should fail transactions on exception', () => {
    expectSaga(fetchTx, last)
      .provide({
        call() {
          throw new Error('Not Found');
        },
      })
      .put.like({ action: { type: 'FETCH_TX_FAILED' } })
      .run();
  });

})

