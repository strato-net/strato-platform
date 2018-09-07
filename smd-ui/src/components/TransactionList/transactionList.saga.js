import {
  takeEvery,
  put,
  call
} from 'redux-saga/effects';
import {
  FETCH_TX,
  fetchTxSuccess,
  fetchTxFailure
} from './transactionList.actions';
import { env } from '../../env';

const url = env.STRATO_URL + "/transaction/last/15";

export function getTx(chainId) {
  const localUrl = chainId ? url + `?chainid=${chainId}` : url;
  return fetch(
    localUrl,
    {
      method: 'GET',
      credentials: "include",
      headers: {
        'Accept': 'application/json'
      },
    })
    .then(function (response) {
      return response.json()
    })
    .then(function (res) {
      return res;
    })
    .catch(function (error) {
      throw error;
    });
}

export function* fetchTx(action) {
  try {
    let response = yield call(getTx, action.last, action.chainId);
    yield put(fetchTxSuccess(response));
  }
  catch (err) {
    yield put(fetchTxFailure(err));
  }
}

export default function* watchFetchTx() {
  yield takeEvery(FETCH_TX, fetchTx);
}
