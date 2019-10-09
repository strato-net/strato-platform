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

const url = env.STRATO_URL + "/transaction";

export function getTx(last, chainId) {
  const urlwithLastTag = last ? `${url}/last/${last}` : url;
  const localUrl = chainId ? `${urlwithLastTag}?chainid=${chainId}` : urlwithLastTag;

  return fetch(
    localUrl,
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
