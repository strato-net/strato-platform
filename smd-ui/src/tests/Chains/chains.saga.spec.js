import {
  takeLatest,
  call,
  put,
  takeEvery
} from 'redux-saga/effects';
import { expectSaga } from 'redux-saga-test-plan';
import {
  FETCH_CHAINS_REQUEST,
  FETCH_CHAIN_IDS_REQUEST,
  FETCH_CHAIN_DETAIL_REQUEST,
  fetchChainsSuccess,
  fetchChainsFailure,
  fetchChainIdsSuccess,
  fetchChainIdsFailure,
  fetchChainDetailSuccess,
  fetchChainDetailFailure,
  FETCH_CHAINS_SUCCESS,
  FETCH_CHAIN_DETAIL_SUCCESS,
  FETCH_CHAIN_DETAIL_FAILURE,
  FETCH_CHAINS_FAILURE,
  FETCH_SELECT_CHAIN_DETAIL_REQUEST
} from '../../components/Chains/chains.actions';
import watchFetchChains, {
  getChains,
  getChainDetail,
  getChainsIds,
  getChainsApi,
  getChainDetailApi,
  getChainDetailSelect
} from '../../components/Chains/chains.saga';
import { chain, chains } from './chainsMock';

describe('Chains: saga', () => {

  test('watch chains', () => {
    const gen = watchFetchChains();
    const match = [
      takeLatest(FETCH_CHAINS_REQUEST, getChains),
      takeLatest(FETCH_CHAIN_IDS_REQUEST, getChainsIds),
      takeEvery(FETCH_CHAIN_DETAIL_REQUEST, getChainDetail),
      takeEvery(FETCH_SELECT_CHAIN_DETAIL_REQUEST, getChainDetailSelect)
    ]
    expect(gen.next().value).toEqual(match);
    expect(gen.next().done).toBe(true);
  })

  describe('getChains generator', () => {
    const payload = { limit: 10, offset: 0 };

    test('inspection', () => {
      const gen = getChains(payload);
      expect(gen.next().value).toEqual(call(getChainsApi, 10, 0, undefined));
      expect(gen.next(chain).value).toEqual(put(fetchChainsSuccess(chain)));
      expect(gen.throw('error').value).toEqual(put(fetchChainsFailure('error')));
      expect(gen.next().done).toBe(true);
    });

    describe('api call', () => {

      test('success', (done) => {
        fetch.mockResponse(JSON.stringify(chains));
        expectSaga(getChains, payload.limit, payload.offset)
          .call.fn(getChainsApi, payload.limit, payload.offset).put.like({ action: { type: FETCH_CHAINS_SUCCESS } })
          .run({ silenceTimeout: true }).then((result) => { done() });
      });

      test('failure', (done) => {
        fetch.mockReject('error');
        expectSaga(getChains, payload.limit, payload.offset)
          .call.fn(getChainsApi, payload.limit, payload.offset).put.like({ action: { type: FETCH_CHAINS_FAILURE } })
          .run().then((result) => { done() });
      });

    });

  });

  describe('getChainsIds generator', () => {

    test('inspection', () => {
      const payload = { limit: 10, offset: 0 };

      const gen = getChainsIds(payload);
      expect(gen.next().value).toEqual(call(getChainsApi, 10, 0));
      expect(gen.next(chain).value).toEqual(put(fetchChainIdsSuccess(chain)));
      expect(gen.throw('error').value).toEqual(put(fetchChainIdsFailure('error')));
      expect(gen.next().done).toBe(true);
    });

  });

  describe('getChainDetail generator', () => {
    const data = {
      id: '64885c49cdc6fe5f15975596115a120ec1e9a616e88a22e0be0457f373d75b73',
      label: 'airline cartel 1'
    };

    test('inspection', () => {
      const gen = getChainDetail(data);
      expect(gen.next().value).toEqual(call(getChainDetailApi, data.id));
      expect(gen.next(chains).value).toEqual(put(fetchChainDetailSuccess(data.label, data.id, chains)));
      expect(gen.throw('error').value).toEqual(put(fetchChainDetailFailure(data.label, data.id, 'error')));
      expect(gen.next().done).toBe(true);
    });

    describe('api call', () => {

      test('success', (done) => {
        fetch.mockResponse(JSON.stringify(chains));
        expectSaga(getChainDetail, data)
          .call.fn(getChainDetailApi, data.label, data.id).put.like({ action: { type: FETCH_CHAIN_DETAIL_SUCCESS } })
          .run({ silenceTimeout: true }).then((result) => { done() });
      });

      test('failure', (done) => {
        fetch.mockReject('error');
        expectSaga(getChainDetail, data)
          .call.fn(getChainDetailApi, data.label, data.id).put.like({ action: { type: FETCH_CHAIN_DETAIL_FAILURE } })
          .run().then((result) => { done() });
      });

    })

  });

})

