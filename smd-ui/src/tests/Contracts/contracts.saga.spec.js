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
    const data = {
      chainId: "ff7ef45acb7a775018bc765b6fdeea432aaddfcd846cf6dd9442724266b1eac9",
      limit: 10,
      offset: 0,
      name: null
    }

    test('inspection', () => {
      const gen = fetchContracts({ type: "FETCH_CONTRACTS", chainId: data.chainId, limit: data.limit, offset: data.offset , name: data.name});
      expect(gen.next().value).toEqual(call(getContracts, data.chainId, data.limit, data.offset, data.name));
      expect(gen.next(contracts).value).toEqual(put(fetchContractsSuccess(contracts)));
      expect(gen.throw(error).value).toEqual(put(fetchContractsFailure(error)));
      expect(gen.next().done).toBe(true);
    })

    describe('fetch contracts', () => {
      test('success', (done) => {
        fetch.mockResponse(JSON.stringify(contracts));
        expectSaga(fetchContracts, data.chainId)
          .call.fn(getContracts).put.like({ action: { type: FETCH_CONTRACTS_SUCCESSFUL } })
          .run().then((result) => { done() });
      });

      test('failure', (done) => {
        fetch.mockReject(JSON.stringify(contracts));
        expectSaga(fetchContracts, data.chainId)
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

