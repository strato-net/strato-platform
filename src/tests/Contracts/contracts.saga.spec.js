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
    expectSaga(fetchContracts)
      .call.fn(getContracts)
      .run()
  });

  test('should failed after contracts fetch', () => {
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

