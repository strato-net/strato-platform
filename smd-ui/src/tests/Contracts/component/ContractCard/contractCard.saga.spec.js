import {
  watchAccount,
  watchFetchState,
  watchFetchCirrusContracts,
  fetchCirrusInstances,
  getCirrusInstances,
  fetchState,
  getState,
  fetchAccount,
  getAccount,
  watchFetchInfo,
  fetchContractInfo,
  getContract
} from '../../../../components/Contracts/components/ContractCard/contractCard.saga';
import {
  takeEvery,
  call,
  put
} from 'redux-saga/effects';
import {
  FETCH_ACCOUNT_REQUEST,
  FETCH_CIRRUS_INSTANCES_REQUEST,
  fetchAccountSuccess,
  fetchCirrusInstancesSuccess,
  FETCH_STATE_REQUEST,
  fetchStateSuccess,
  FETCH_CONTRACT_INFO_REQUEST,
  fetchContractInfoRequest,
  fetchContractInfoSuccess,
  fetchContractInfoFailure
} from '../../../../components/Contracts/components/ContractCard/contractCard.actions';
import { expectSaga } from 'redux-saga-test-plan';
import { accounts, cirrus, state, contractInfoResponse } from './contractCardMock'

describe('ContractCard: saga', () => {

  // fetch accounts test 
  test('watch accounts', () => {
    const gen = watchAccount();
    expect(gen.next().value).toEqual(takeEvery(FETCH_ACCOUNT_REQUEST, fetchAccount))
  })

  test('account api', () => {
    const gen = fetchAccount({ type: "FETCH_ACCOUNT_REQUEST", address: '3771b31420eda628bf03cd5b119249da0fb4aa6d', name: 'Greeter' });
    expect(gen.next().value).toEqual(call(getAccount, '3771b31420eda628bf03cd5b119249da0fb4aa6d'));
    expect(gen.next().value).toEqual(put(fetchAccountSuccess('Greeter', '3771b31420eda628bf03cd5b119249da0fb4aa6d')))
  })

  test('watch contract args', () => {
    const gen = watchFetchInfo();
    expect(gen.next().value).toEqual(takeEvery(FETCH_CONTRACT_INFO_REQUEST, fetchContractInfo))
  })

  
  describe('fetch contract info - sagas', () => {

    test('success', () => {
      fetch.mockResponse(JSON.stringify(contractInfoResponse))
      expectSaga(fetchContractInfo, {
        key: 'key',
        name: 'abc',
        address: 'xyz',
        chainId: '4261aa13'
      })
        .call.fn(getContract, 'Cloner', 'eb58f377c7d419e9945b5096cd478b6a7eef9831', 'geneticallyModify').put.like({ action: { type: 'FETCH_CONTRACT_INFO_SUCCESS' } })
        .run()
    });

    test('failure', () => {
      fetch.mockReject(JSON.stringify(contractInfoResponse))
      expectSaga(fetchContractInfo, {
        name: 'abc',
        address: 'xyz',
        symbol: 'geneticallyModify',
        key: 'key'
      })
        .call.fn(getContract, 'Cloner', 'eb58f377c7d419e9945b5096cd478b6a7eef9831', 'geneticallyModify').put.like({ action: { type: 'FETCH_CONTRACT_INFO_FAILURE' } })
        .run()
    });

    test('exception', () => {
      expectSaga(fetchContractInfo, 'Cloner', 'eb58f377c7d419e9945b5096cd478b6a7eef9831', 'cloneSheep')
        .provide({
          call() {
            throw new Error('Not Found');
          },
        })
        .put.like({ action: { type: 'FETCH_CONTRACT_INFO_FAILURE' } })
        .run();
    });

  })

  describe('fetch accounts', () => {

    test('success', () => {
      fetch.mockResponse(JSON.stringify(accounts))
      expectSaga(fetchAccount, '3771b31420eda628bf03cd5b119249da0fb4aa6d')
        .call.fn(getAccount).put.like({ action: { type: 'FETCH_ACCOUNT_SUCCESS' } })
        .run()
    });

    test('failure', () => {
      fetch.mockReject(JSON.stringify(accounts))
      expectSaga(fetchAccount, '3771b31420eda628bf03cd5b119249da0fb4aa6d')
        .call.fn(getAccount).put.like({ action: { type: 'FETCH_ACCOUNT_FAILURE' } })
        .run()
    });

    test('exception', () => {
      expectSaga(fetchAccount, '3771b31420eda628bf03cd5b119249da0fb4aa6d')
        .provide({
          call() {
            throw new Error('Not Found');
          },
        })
        .put.like({ action: { type: 'FETCH_ACCOUNT_FAILURE' } })
        .run();
    });

  })

  // fetch state tests
  test('watch states', () => {
    const gen = watchFetchState();
    expect(gen.next().value).toEqual(takeEvery(FETCH_STATE_REQUEST, fetchState))
  })

  test('state inspection', () => {
    const data = { type: "FETCH_STATE_REQUEST", address: '3771b31420eda628bf03cd5b119249da0fb4aa6d', name: 'Greeter', chainId: "ff7ef45acb7a775018bc765b6fdeea432aaddfcd846cf6dd9442724266b1eac9" };
    const gen = fetchState(data);
    expect(gen.next().value).toEqual(call(getState, data.name, data.address, data.chainId));
    expect(gen.next().value).toEqual(put(fetchStateSuccess(data.name, data.address)))
  })

  describe('fetch states', () => {

    test('success', () => {
      fetch.mockResponse(JSON.stringify(state))
      expectSaga(fetchState, '3771b31420eda628bf03cd5b119249da0fb4aa6d')
        .call.fn(getState).put.like({ action: { type: 'FETCH_STATE_SUCCESS' } })
        .run()
    });

    test('failure', () => {
      fetch.mockReject(JSON.stringify(state))
      expectSaga(fetchState, '3771b31420eda628bf03cd5b119249da0fb4aa6d')
        .call.fn(getState).put.like({ action: { type: 'FETCH_STATE_FAILURE' } })
        .run()
    });

    test('exception', () => {
      expectSaga(fetchState, '3771b31420eda628bf03cd5b119249da0fb4aa6d')
        .provide({
          call() {
            throw new Error('Not Found');
          },
        })
        .put.like({ action: { type: 'FETCH_STATE_FAILURE' } })
        .run();
    });

  })

  // fetch cirrus tests
  test('watch cirrus', () => {
    const gen = watchFetchCirrusContracts();
    expect(gen.next().value).toEqual(takeEvery(FETCH_CIRRUS_INSTANCES_REQUEST, fetchCirrusInstances))
  })

  test('cirrus inspection', () => {
    const gen = fetchCirrusInstances({ type: "FETCH_CIRRUS_INSTANCES_REQUEST", name: 'Greeter', chainId : "abcdef123456" });
    expect(gen.next().value).toEqual(call(getCirrusInstances, 'Greeter',  "abcdef123456"));
    expect(gen.next().value).toEqual(put(fetchCirrusInstancesSuccess('Greeter')))
  })

  describe('fetch cirrus', () => {

    test('success', () => {
      fetch.mockResponse(JSON.stringify(cirrus))
      expectSaga(fetchCirrusInstances, 'Greeter')
        .call.fn(getCirrusInstances).put.like({ action: { type: 'FETCH_CIRRUS_INSTANCES_SUCCESS' } })
        .run()
    });

    test('failure', () => {
      fetch.mockReject(JSON.stringify(cirrus))
      expectSaga(fetchCirrusInstances, 'Greeter')
        .call.fn(getCirrusInstances).put.like({ action: { type: 'FETCH_CIRRUS_INSTANCES_FAILURE' } })
        .run()
    });

    test('exception', () => {
      expectSaga(fetchCirrusInstances, 'Greeter')
        .provide({
          call() {
            throw new Error('Not Found');
          },
        })
        .put.like({ action: { type: 'FETCH_CIRRUS_INSTANCES_FAILURE' } })
        .run();
    });

  })

})

