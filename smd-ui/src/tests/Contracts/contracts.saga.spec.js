import watchFetchContracts, {
  fetchContracts,
  getContracts
} from '../../components/Contracts/contracts.saga';
import {
  takeEvery,
  call,
  put
} from 'redux-saga/effects';
import {
  FETCH_CONTRACTS,
  fetchContractsSuccess,
  FETCH_CONTRACTS_SUCCESSFUL,
  fetchContractsFailure,
  FETCH_CONTRACTS_FAILED
} from '../../components/Contracts/contracts.actions';
import { expectSaga } from 'redux-saga-test-plan';
import { contracts, error } from './contractsMock';

describe('Contracts: saga', () => {

  test('should watch contracts', () => {
    const gen = watchFetchContracts();
    expect(gen.next().value).toEqual(takeEvery(FETCH_CONTRACTS, fetchContracts))
  })

  describe('fetchContracts generator', () => {

    test('inspection', () => {
      const gen = fetchContracts({ type: "FETCH_CONTRACTS" });
      expect(gen.next().value).toEqual(call(getContracts));
      expect(gen.next(contracts).value).toEqual(put(fetchContractsSuccess(contracts)));
      expect(gen.throw(error).value).toEqual(put(fetchContractsFailure(error)));
      expect(gen.next().done).toBe(true);
    })

    describe('fetch contracts', () => {
      test('success', (done) => {
        fetch.mockResponse(JSON.stringify(contracts));
        expectSaga(fetchContracts)
          .call.fn(getContracts).put.like({ action: { type: FETCH_CONTRACTS_SUCCESSFUL } })
          .run().then((result) => { done() });
      });

      test('failure', (done) => {
        fetch.mockReject(JSON.stringify(contracts));
        expectSaga(fetchContracts)
          .call.fn(getContracts).put.like({ action: { type: FETCH_CONTRACTS_FAILED } })
          .run().then((result) => { done() });
      });

      test('exception', () => {
        expectSaga(fetchContracts)
          .provide({
            call() {
              throw new Error('Not Found');
            },
          })
          .put.like({ action: { type: FETCH_CONTRACTS_FAILED } })
          .run();
      });

    })

  });

})

