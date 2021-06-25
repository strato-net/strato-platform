import { expectSaga } from 'redux-saga-test-plan';
import {
  takeEvery,
  put,
  call
} from 'redux-saga/effects';
import { watchExecuteQuery,
  executeQuery,
  query,
  watchTransactionResult,
  getTransactionResult,
  transactionResultRequest
} from '../../components/QueryEngine/queryEngine.saga';
import {
  EXECUTE_QUERY_REQUEST,
  executeQuerySuccess,
  executeQueryFailure,
  EXECUTE_QUERY_SUCCESS,
  EXECUTE_QUERY_FAILURE,
  TRANSACTION_RESULT_REQUEST,
  TRANSACTION_RESULT_SUCCESS,
  TRANSACTION_RESULT_FAILURE,
  getTransactionResultSuccess,
  getTransactionResultFailure,
  getTransactionResultRequest
} from '../../components/QueryEngine/queryEngine.actions';
import { transactionsMock, blocksMock, resultsMock, error } from './queryEngineMock';

describe('QueryEngine: saga', () => {

  test('watch execute query', () => {
    const gen = watchExecuteQuery();
    expect(gen.next().value).toEqual(takeEvery(EXECUTE_QUERY_REQUEST, executeQuery));
    expect(gen.next().done).toBe(true);
  });

  describe('executeQuery generator with transactions', () => {

    const action = {
      query: { last: 15 },
      resourceType: "/transaction",
      chainId: "ff7ef45acb7a775018bc765b6fdeea432aaddfcd846cf6dd9442724266b1eac9",
      type: EXECUTE_QUERY_REQUEST
    }

    test('inspection', () => {
      const gen = executeQuery(action);

      expect(gen.next().value).toEqual(call(query, action.query, action.resourceType, action.chainId));
      expect(gen.next(transactionsMock).value).toEqual(put(executeQuerySuccess(transactionsMock)));
      expect(gen.throw(error).value).toEqual(put(executeQueryFailure(error)));
      expect(gen.next().done).toBe(true);
    });

    test('call query with success', (done) => {
      fetch.mockResponse(JSON.stringify(transactionsMock));

      expectSaga(executeQuery, action)
        .call.fn(query).put.like({ action: { type: EXECUTE_QUERY_SUCCESS } })
        .run().then((result) => { done() });
    });

    test('call query with failure', (done) => {
      fetch.mockReject(JSON.stringify(error));

      expectSaga(executeQuery, action)
        .call.fn(query).put.like({ action: { type: EXECUTE_QUERY_FAILURE } })
        .run().then((result) => { done() });
    });

  });

  describe('executeQuery generator with block', () => {

    const action = {
      query: { gaslim: 10, last: 15, number: 203976 },
      resourceType: "/block",
      chainId: "ff7ef45acb7a775018bc765b6fdeea432aaddfcd846cf6dd9442724266b1eac9",
      type: EXECUTE_QUERY_REQUEST
    }

    test('inspection', () => {
      const gen = executeQuery(action);

      expect(gen.next().value).toEqual(call(query, action.query, action.resourceType, action.chainId));
      expect(gen.next(blocksMock).value).toEqual(put(executeQuerySuccess(blocksMock)));
      expect(gen.throw(error).value).toEqual(put(executeQueryFailure(error)));
      expect(gen.next().done).toBe(true);
    });

    test('call query with success', (done) => {
      fetch.mockResponse(JSON.stringify(blocksMock));

      expectSaga(executeQuery, action)
        .call.fn(query).put.like({ action: { type: EXECUTE_QUERY_SUCCESS } })
        .run().then((result) => { done() });
    });

  });


  test('watchTransactionResult', () => {
    const gen = watchTransactionResult();
    expect(gen.next().value).toEqual(takeEvery(TRANSACTION_RESULT_REQUEST, getTransactionResult));
    expect(gen.next().done).toBe(true);
  });

  describe('getTransactionResult generator', () => {

    const action = {
      txHash : "ef1c523bd46a",
      type: EXECUTE_QUERY_REQUEST
    }

    test('inspection', () => {
      const gen = getTransactionResult(action);
      expect(gen.next().value).toEqual(call(transactionResultRequest, action.txHash));
      expect(gen.next(resultsMock).value).toEqual(put(getTransactionResultSuccess(resultsMock)));
      expect(gen.throw(error).value).toEqual(put(getTransactionResultFailure(error)));
      expect(gen.next().done).toBe(true);
    });

    test('call transactions result with success', (done) => {
      fetch.mockResponse(JSON.stringify(resultsMock));

      expectSaga(getTransactionResult, action)
        .call.fn(transactionResultRequest).put.like({ action: { type: TRANSACTION_RESULT_SUCCESS } })
        .run().then((result) => { done() });
    });

    test('call transactions result with failure', (done) => {
      fetch.mockReject(JSON.stringify(error));

      expectSaga(getTransactionResult, action)
        .call.fn(transactionResultRequest).put.like({ action: { type: TRANSACTION_RESULT_FAILURE } })
        .run().then((result) => { done() });
    });

  });
});