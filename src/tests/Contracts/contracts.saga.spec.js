import watchFetchContracts, {
  fetchContracts,
  getContracts
} from '../../components/Contracts/contracts.saga';
import {
  takeEvery,
  call
} from 'redux-saga/effects';
import {
  FETCH_CONTRACTS
} from '../../components/Contracts/contracts.actions';

describe('Test contracts saga', () => {

  test('should watch contracts', () => {
    const gen = watchFetchContracts();
    expect(gen.next().value).toEqual(takeEvery(FETCH_CONTRACTS, fetchContracts))
  })

  test('should check the saga api', () => {
    const gen = fetchContracts({ type: "FETCH_CONTRACTS" });
    expect(gen.next().value).toEqual(call(getContracts));
  })

})