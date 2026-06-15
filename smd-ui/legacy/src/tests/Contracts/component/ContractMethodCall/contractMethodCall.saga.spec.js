import {
  watchMethodCall,
  watchFetchArgs,
  fetchArgs,
  methodCall,
  getArgs,
  postMethodCall
} from '../../../../components/Contracts/components/ContractMethodCall/contractMethodCall.saga';
import { fetchState } from '../../../../components/Contracts/components/ContractCard/contractCard.actions'
import {
  takeEvery,
  call,
  put
} from 'redux-saga/effects';
import {
  methodCallSuccess,
  METHOD_CALL_FETCH_ARGS_REQUEST,
  METHOD_CALL_REQUEST,
} from '../../../../components/Contracts/components/ContractMethodCall/contractMethodCall.actions';
import { expectSaga } from 'redux-saga-test-plan';
import { methodCallArgs } from './contractMethodCallMock'

describe('ContractMethodCall: saga', () => {

  

  test('watch states', () => {
    const gen = watchMethodCall();
    expect(gen.next().value).toEqual(takeEvery(METHOD_CALL_REQUEST, methodCall))
  })


  test('state api inspection', () => {
    const gen = methodCall({ payload: { contractName: 'Greeter', contractAddress: '3771b31420eda628bf03cd5b119249da0fb4aa6d' }, key: 'key' });
    expect(gen.next().value).toEqual(call(postMethodCall, { contractName: 'Greeter', contractAddress: '3771b31420eda628bf03cd5b119249da0fb4aa6d' }));
    expect(gen.next().value).toEqual(put(fetchState('Greeter', '3771b31420eda628bf03cd5b119249da0fb4aa6d')))
    expect(gen.next().value).toEqual(put(methodCallSuccess('key')))
  })

  describe('fetch states', () => {

    test('success', () => {
      fetch.mockResponse(JSON.stringify(methodCallArgs))
      expectSaga(methodCall, { payload: { username: 'abc', userAddress: 'xyz', contractName: 'Greeter', contractAddress: '3771b31420eda628bf03cd5b119249da0fb4aa6d', value: '22.3' } })
        .call.fn(postMethodCall, { value: '22.0', username: 'abc', userAddress: 'xyz', contractName: 'Greeter', contractAddress: '3771b31420eda628bf03cd5b119249da0fb4aa6d' }).put.like({ action: { type: 'METHOD_CALL_SUCCESS' } })
        .run()
    });

    test('failure', () => {
      fetch.mockReject(JSON.stringify(methodCallArgs))
      expectSaga(methodCall, { payload: { username: 'abc', userAddress: 'xyz', contractName: 'Greeter', contractAddress: '3771b31420eda628bf03cd5b119249da0fb4aa6d' } })
        .call.fn(postMethodCall, { username: 'abc', userAddress: 'xyz', contractName: 'Greeter', contractAddress: '3771b31420eda628bf03cd5b119249da0fb4aa6d' }).put.like({ action: { type: 'METHOD_CALL_FAILURE' } })
        .run()
    });

    test('exception', () => {
      expectSaga(methodCall, { contractName: 'Greeter', contractAddress: '3771b31420eda628bf03cd5b119249da0fb4aa6d' }, 'key')
        .provide({
          call() {
            throw new Error('Not Found');
          },
        })
        .put.like({ action: { type: 'METHOD_CALL_FAILURE' } })
        .run();
    });

  })

})

