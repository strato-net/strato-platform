import {
  watchQueryCirrus,
  watchQueryCirrusVars,
  queryCirrus,
  queryCirrusVars,
  queryCirrusRequest,
  queryCirrusVarsRequest
} from "../../components/ContractQuery/contractQuery.saga";
import {
  QUERY_CIRRUS_REQUEST,
  QUERY_CIRRUS_VARS_REQUEST,
  queryCirrusSuccess,
  queryCirrusFailure,
  QUERY_CIRRUS_SUCCESS,
  QUERY_CIRRUS_FAILURE,
  queryCirrusVarsSuccess,
  queryCirrusVarsFailure,
  QUERY_CIRRUS_VARS_SUCCESS,
  QUERY_CIRRUS_VARS_FAILURE
} from "../../components/ContractQuery/contractQuery.actions";
import {
  takeEvery,
  call,
  put
} from 'redux-saga/effects';
import { expectSaga } from 'redux-saga-test-plan';
import { queryCirrusMock, error, queryCirrusVarsMock } from "./contractQueryMock";

describe('ContractQuery: saga', () => {

  test('watch query cirrus', () => {
    const gen = watchQueryCirrus();
    expect(gen.next().value).toEqual(takeEvery(QUERY_CIRRUS_REQUEST, queryCirrus));
    expect(gen.next().done).toBe(true);
  });

  describe('queryCirrus generator', () => {
    const action = {
      contractName: "Bid",
      queryString: "",
      chainId: "ff7ef45acb7a775018bc765b6fdeea432aaddfcd846cf6dd9442724266b1eac9",
      type: QUERY_CIRRUS_REQUEST
    }

    test('inspection', () => {
      const gen = queryCirrus(action);
      expect(gen.next().value).toEqual(call(queryCirrusRequest, action.contractName, action.queryString, action.chainId));
      expect(gen.next(queryCirrusMock).value).toEqual(put(queryCirrusSuccess(queryCirrusMock)));
      expect(gen.throw(error).value).toEqual(put(queryCirrusFailure(error)));
      expect(gen.next().done).toBe(true);
    });

    describe('fetch querycirrus', () => {

      test('success', (done) => {
        fetch.mockResponse(JSON.stringify(queryCirrusMock));
        expectSaga(queryCirrus, action)
          .call.fn(queryCirrusRequest).put.like({ action: { type: QUERY_CIRRUS_SUCCESS } })
          .run().then((result) => { done() });
      });

      test('failure', (done) => {
        fetch.mockReject(JSON.stringify(error));
        expectSaga(queryCirrus, action)
          .call.fn(queryCirrusRequest).put.like({ action: { type: QUERY_CIRRUS_FAILURE } })
          .run().then((result) => { done() });
      });

    })

  });

  test('watch query cirrus vars', () => {
    const gen = watchQueryCirrusVars();
    expect(gen.next().value).toEqual(takeEvery(QUERY_CIRRUS_VARS_REQUEST, queryCirrusVars));
    expect(gen.next().done).toBe(true);
  });

  describe('queryCirrusVars generator', () => {

    const action = {
      contractName: "Bid",
      type: QUERY_CIRRUS_VARS_REQUEST
    }

    test('inspection', () => {
      const gen = queryCirrusVars(action);
      expect(gen.next().value).toEqual(call(queryCirrusVarsRequest, action.contractName));
      expect(gen.next(queryCirrusVarsMock).value).toEqual(put(queryCirrusVarsSuccess(queryCirrusVarsMock.xabi.vars)));
      expect(gen.throw(error).value).toEqual(put(queryCirrusVarsFailure(error)));
      expect(gen.next().done).toBe(true);
    });

    describe('fetch queryCirrusVars', () => {

      test('success', (done) => {
        fetch.mockResponse(JSON.stringify(queryCirrusVarsMock));
        expectSaga(queryCirrusVars, action)
          .call.fn(queryCirrusVarsRequest).put.like({ action: { type: QUERY_CIRRUS_VARS_SUCCESS } })
          .run().then((result) => { done() });
      });

      test('failure', (done) => {
        fetch.mockReject(JSON.stringify(error));
        expectSaga(queryCirrusVars, action)
          .call.fn(queryCirrusVarsRequest).put.like({ action: { type: QUERY_CIRRUS_VARS_FAILURE } })
          .run().then((result) => { done() });
      });

    })

  });

});