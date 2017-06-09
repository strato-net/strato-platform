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
import {NODES} from '../../env';

const url = NODES[0].url + "strato-api/eth/v1.2/transaction/last/";

function getTx(last) {
  if (last === undefined) last = 15;
  return fetch(
    url + last.toString(),
    {
      method: 'GET',
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

function* fetchTx(action) {
  try {
    let response = yield call(getTx, action.last);
    yield put(fetchTxSuccess(response));
  }
  catch (err) {
    yield put(fetchTxFailure(err));
  }
}

export default function* watchFetchTx() {
  yield takeEvery(FETCH_TX, fetchTx);
}
