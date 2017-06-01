import {
  takeEvery,
  put,
  call
} from 'redux-saga/effects';
import {
  FETCH_BLOCK_DATA,
  fetchBlockDataSuccess,
  fetchBlockDataFailure
} from './block-data.actions';
import { APIURL } from '../../env';

const url = APIURL + "/strato-api/eth/v1.2/block/last/15"

function getBlockData() {
  return fetch(
    url,
    {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
    },
  })
    .then(function(response) {
      return response.json()
    })
    .then(function(res) {
      return res;
    })
    .catch(function(error) {
      throw error;
    });
}

function* fetchBlockData(action) {
  try {
    let response = yield call(getBlockData);
    yield put(fetchBlockDataSuccess(response));
  }
  catch (err) {
    yield put(fetchBlockDataFailure(err));
  }
}

export default function* watchFetchBlockData() {
  yield takeEvery(FETCH_BLOCK_DATA, fetchBlockData);
}
