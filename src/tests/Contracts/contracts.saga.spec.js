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
  fetchContractsSuccess
} from '../../components/Contracts/contracts.actions';
import { expectSaga } from 'redux-saga-test-plan';
import { contracts } from './contractsMock'

describe('Test contracts saga', () => {

  test('should watch contracts', () => {
    const gen = watchFetchContracts();
    expect(gen.next().value).toEqual(takeEvery(FETCH_CONTRACTS, fetchContracts))
  })

  test('should check the saga api', () => {
    const gen = fetchContracts({ type: "FETCH_CONTRACTS" });
    expect(gen.next().value).toEqual(call(getContracts));
    expect(gen.next().value).toEqual(put(fetchContractsSuccess()))
  })

  test('should call fetch contracts', () => {
    fetch.mockResponse(JSON.stringify(contracts))
    expectSaga(fetchContracts)
      .call.fn(getContracts).put.like({ action: { type: 'FETCH_CONTRACTS_SUCCESSFUL' } })
      .run()
  });

  test('should call fetch contracts failure', () => {
    fetch.mockReject(JSON.stringify(contracts))
    expectSaga(fetchContracts)
      .call.fn(getContracts).put.like({ action: { type: 'FETCH_CONTRACTS_FAILED' } })
      .run()
  });

  test('should fail contracts on exception', () => {
    expectSaga(fetchContracts)
      .provide({
        call() {
          throw new Error('Not Found');
        },
      })
      .put.like({ action: { type: 'FETCH_CONTRACTS_FAILED' } })
      .run();
  });

})

