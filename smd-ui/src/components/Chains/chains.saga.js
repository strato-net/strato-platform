import {
  takeLatest,
  takeEvery,
  put,
  call,
  cancelled
} from 'redux-saga/effects';
import {
  FETCH_CHAINS,
  FETCH_CHAIN_DETAIL_REQUEST,
  fetchChainsSuccess,
  fetchChainsFailure,
  fetchChainDetail,
  fetchChainDetailSuccess,
  fetchChainDetailFailure
} from './chains.actions';
import { env } from '../../env';
import { hideLoading } from 'react-redux-loading-bar';

const chainUrl = env.STRATO_URL + "/chain";
const chainUrl2 = env.BLOC_URL + "/chain";

export function getChainsApi() {
  return fetch(
    chainUrl,
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

export function getChainDetailApi(chainid) {
  return fetch(
    chainUrl2.concat("?chainid=", chainid),
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

    if (Object.getOwnPropertyNames(response).length > 0) {
      const label = response[0].info.label;
      const address = response[0].id;
      yield put(fetchChainDetail(label, address));
    }
  }
  catch (err) {
    yield put(fetchChainsFailure(err));
  } finally {
    if (yield cancelled()) {
      yield put(hideLoading());
    }
  }
}

export function* getChainDetail(action) {
  try {
    const response = yield call(getChainDetailApi, action.id);
    yield put(fetchChainDetailSuccess(action.label, action.id, response));
  }
  catch (err) {
    yield put(fetchChainDetailFailure(action.label, action.id, err));
  }
}

export default function* watchFetchChains() {
  yield [
    takeLatest(FETCH_CHAINS, getChains),
    takeEvery(FETCH_CHAIN_DETAIL_REQUEST, getChainDetail)
  ];
}
