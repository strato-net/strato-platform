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
import { handleErrors } from '../../lib/handleErrors';
import { createUrl } from '../../lib/url';


const blocUrl = env.STRATO_URL + "/block/last/15"

export function getBlockData(chainid) {
  const options = { query: { chainid } };
  const url = createUrl(blocUrl, options);

  return fetch(
    url,
    {
      method: 'GET',
      credentials: "include",
      headers: {
        'Accept': 'application/json'
      },
    })
    .then(handleErrors)
    .then(function (res) {
      return res.json();
    })
    .catch(function (error) {
      throw error;
    });
}

export function* fetchBlockData(action) {
  try {
    let response = yield call(getBlockData, action.chainId);
    yield put(fetchBlockDataSuccess(response));
  }
  catch (err) {
    yield put(fetchBlockDataFailure(err));
  }
}

export default function* watchFetchBlockData() {
  yield takeEvery(FETCH_BLOCK_DATA, fetchBlockData);
}
