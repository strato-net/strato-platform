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
import { NODES } from '../../env';


const url = NODES[0].STRATO_URL + "/block/last/15"

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
