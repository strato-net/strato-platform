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
import { env } from '../../env';


const url = env.STRATO_URL + "/block/last/15"

export function getBlockData() {
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

export function* fetchBlockData(action) {
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
