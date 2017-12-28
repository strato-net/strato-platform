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

describe('Test QueryEngine saga', () => {

  test('should watch execute query', () => {
    const gen = watchExecuteQuery();
    expect(gen.next().value).toEqual(takeEvery(EXECUTE_QUERY_REQUEST, executeQuery));
    expect(gen.next().done).toBe(true);
  });

  describe('executeQuery generator with transactions', () => {

    const action = {
      query: { last: 15 },
      resourceType: "/transaction",
      type: EXECUTE_QUERY_REQUEST
    }

    test('inspection', () => {
      const gen = executeQuery(action);

      expect(gen.next().value).toEqual(call(query, action.query, action.resourceType));
      expect(gen.next(transactionsMock).value).toEqual(put(executeQuerySuccess(transactionsMock)));
      expect(gen.throw(error).value).toEqual(put(executeQueryFailure(error)));
      expect(gen.next().done).toBe(true);
    });

    test('should call query with success', (done) => {
      fetch.mockResponse(JSON.stringify(transactionsMock));

      expectSaga(executeQuery, action)
        .call.fn(query).put.like({ action: { type: EXECUTE_QUERY_SUCCESS } })
        .run().then((result) => { done() });
    });

    test('should call query with failure', (done) => {
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
      type: EXECUTE_QUERY_REQUEST
    }

    test('inspection', () => {
      const gen = executeQuery(action);

      expect(gen.next().value).toEqual(call(query, action.query, action.resourceType));
      expect(gen.next(blocksMock).value).toEqual(put(executeQuerySuccess(blocksMock)));
      expect(gen.throw(error).value).toEqual(put(executeQueryFailure(error)));
      expect(gen.next().done).toBe(true);
    });

    test('should call query with success', (done) => {
      fetch.mockResponse(JSON.stringify(blocksMock));

      expectSaga(executeQuery, action)
        .call.fn(query).put.like({ action: { type: EXECUTE_QUERY_SUCCESS } })
        .run().then((result) => { done() });
    });

  });

});