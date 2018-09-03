import { expectSaga } from 'redux-saga-test-plan';
import {
  takeEvery,
  put,
  call
} from 'redux-saga/effects';
import watchExecuteQuery, {
  executeQuery,
  query
} from '../../components/QueryEngine/queryEngine.saga';
import {
  EXECUTE_QUERY_REQUEST,
  executeQuerySuccess,
  executeQueryFailure,
  EXECUTE_QUERY_SUCCESS,
  EXECUTE_QUERY_FAILURE
} from '../../components/QueryEngine/queryEngine.actions';
import { transactionsMock, error, blocksMock } from './queryEngineMock';

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

});