import {
  watchQueryCirrus,
  watchQueryCirrusVars,
  queryCirrus,
  queryCirrusVars,
  queryCirrusRequest,
  queryCirrusVarsRequest,
  queryCirrusAddressRequest
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
  QUERY_CIRRUS_VARS_FAILURE,
  QUERY_CIRRUS_ADDRESS_SUCCESS,
  queryCirrusAddressSuccess
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
      tableName: "Bid",
      queryString: "",
      type: QUERY_CIRRUS_REQUEST
    }

    test('inspection', () => {
      const gen = queryCirrus(action);
      expect(gen.next().value).toEqual(call(queryCirrusRequest, action.tableName, action.queryString));
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

  // skipped since we don't fetch cirrus vars anymore in a separate call
  xdescribe('queryCirrusVars generator', () => {

    const action = {
      type: QUERY_CIRRUS_VARS_REQUEST,
      contractName: "Bid",
      contractAddress : "abcdef"
    }
    describe('inspection', () => {
      const mockResponse = {
        xabi : {
          vars : {
            x : {
              val : 0, 
            },
            y : {
              val : 1,
            },
            firstName : {
              val : "Bob"
            }
          }
        }
      }
      const gen = queryCirrusVars(action);
      expect(gen.next(action.contractName).value).toEqual(call(queryCirrusAddressRequest, action.contractName));
      expect(gen.next([action.contractAddress]).value).toEqual({'@@redux-saga/IO' : true, 'PUT' : {channel : null, action: queryCirrusAddressSuccess(action.contractAddress)}});
      expect(gen.next().value).toEqual(call(queryCirrusVarsRequest, action.contractName, action.contractAddress));
      expect(gen.next(mockResponse).value).toEqual({'@@redux-saga/IO' : true, 'PUT' : {channel : null, action: queryCirrusVarsSuccess(mockResponse.xabi.vars)}});
      // expect(gen.next(vars).value).toEqual({'@@redux-saga/IO' : true, 'PUT' : {channel : null, action: queryCirrusVarsSuccess(vars)}})
      // expect(gen.next().value).toEqual(put(queryCirrusAddressSuccess(action.contractName)));
      // expect(gen.next().value).toEqual(call(queryCirrusVarsRequest, action.contractName, action.contractAddress));
      // expect(gen.next(queryCirrusVarsMock).value).toEqual(put(queryCirrusVarsSuccess(queryCirrusVarsMock.xabi.vars)));
      // expect(gen.throw(error).value).toEqual(put(queryCirrusVarsFailure(error)));
      expect(gen.next().done).toBe(true);
      
    })
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
          .call.fn(queryCirrusAddressRequest).put.like({ action: { type: QUERY_CIRRUS_VARS_FAILURE } })
          .run().then((result) => { done() });
      });

    })

  });

});