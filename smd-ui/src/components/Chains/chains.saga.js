import {
  takeLatest,
  takeEvery,
  put,
  call,
  cancelled
} from 'redux-saga/effects';
import {
  FETCH_CHAINS,
  FETCH_CHAINS_SUCCESSFULL,
  FETCH_CHAINS_FAILED,
  fetchChainsSuccess,
  fetchChainsFailure
} from './chains.actions';
import { env } from '../../env';
import { hideLoading } from 'react-redux-loading-bar';
import { delay } from 'redux-saga';

const chainUrl = env.STRATO_URL + "/chain?chainid=:chainid"

export function getChainsApi(chainid) {
  return fetch(
    chainUrl.replace(':chainid',chainid),
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
    .catch(function (error) {
      throw error;
    })
}

export function* getChains(action) {
  try {
    const response = yield call(getChainsApi);
    yield put(fetchChainsSuccess(response));
  }
  catch (err) {
    yield put(fetchChainsFailure(err));
  } finally {
    if (yield cancelled()) {
      yield put(hideLoading());
    }
  }
}

export default function* watchFetchChains() {
  yield [
    takeLatest(FETCH_CHAINS, getChains),
  ];
}
