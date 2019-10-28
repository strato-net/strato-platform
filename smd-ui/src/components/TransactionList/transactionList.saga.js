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
import { handleErrors } from '../../lib/handleErrors';
import { createUrl } from '../../lib/url';

const urlLastFifteen = env.STRATO_URL + "/transaction/last/15";

export function getTx(last, chainid) {
  const options = { query: { chainid } };
  const url = createUrl(urlLastFifteen, options);

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
