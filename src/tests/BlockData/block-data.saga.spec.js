import watchFetchBlockData, {
  fetchBlockData,
  getBlockData
} from '../../components/BlockData/block-data.saga';
import {
  takeEvery,
  call,
  put
} from 'redux-saga/effects';
import {
  FETCH_BLOCK_DATA,
  fetchBlockDataSuccess,
  fetchBlockDataFailure,
  FETCH_BLOCK_DATA_SUCCESSFUL,
  FETCH_BLOCK_DATA_FAILED
} from '../../components/BlockData/block-data.actions';
import { blocksMock, error } from './blockDataMock';
import { expectSaga } from 'redux-saga-test-plan';

describe('Test BlockData saga', () => {

  test('should watch applications', () => {
    const gen = watchFetchBlockData();
    expect(gen.next().value).toEqual(takeEvery(FETCH_BLOCK_DATA, fetchBlockData))
    expect(gen.next().done).toBe(true);
  });

  describe('fetchBlockData generator', () => {

    const action = {
      type: FETCH_BLOCK_DATA
    }

    test('inspection', () => {
      const gen = fetchBlockData(action);

      expect(gen.next().value).toEqual(call(getBlockData));
      expect(gen.next(blocksMock).value).toEqual(put(fetchBlockDataSuccess(blocksMock)));
      expect(gen.throw(error).value).toEqual(put(fetchBlockDataFailure(error)));
      expect(gen.next().done).toBe(true);
    });

    test('should get block data with success', (done) => {
      fetch.mockResponse(JSON.stringify(blocksMock));

      expectSaga(fetchBlockData, action)
        .call.fn(getBlockData).put.like({ action: { type: FETCH_BLOCK_DATA_SUCCESSFUL } })
        .run().then((result) => { done() });
    });

    test('should get block data with failure', (done) => {
      fetch.mockReject(JSON.stringify(error));

      expectSaga(fetchBlockData, action)
        .call.fn(getBlockData).put.like({ action: { type: FETCH_BLOCK_DATA_FAILED } })
        .run().then((result) => { done() });
    });

  });

});