import {
  takeLatest,
  takeEvery,
  put,
  call
} from 'redux-saga/effects';
import {
  FETCH_CHAINS_REQUEST,
  FETCH_CHAIN_DETAIL_REQUEST,
  fetchChainsSuccess,
  fetchChainsFailure,
  fetchChainDetailSuccess,
  fetchChainDetailFailure,
  fetchChainIdsSuccess,
  fetchChainIdsFailure,
  FETCH_CHAIN_IDS_REQUEST
} from './chains.actions';
import { env } from '../../env';
import { handleErrors } from '../../lib/handleErrors';
import { createUrl } from '../../lib/url';

const stratoChainUrl = env.STRATO_URL + "/chain";
const blocChainUrl = env.BLOC_URL + "/chain";

export function getChainsApi() {
  return fetch(
    stratoChainUrl,
    {
      method: 'GET',
      credentials: "include",
      headers: {
        'Accept': 'application/json'
      },
    })
    .then(handleErrors)
    .then(function (response) {
      return response.json()
    })
    .catch(function (error) {
      throw error;
    })
}

export function getChainDetailApi(chainid) {
  const options = { query: { chainid } };
  const url = createUrl(blocChainUrl, options);

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
    .then(function (response) {
      return response.json()
    })
    .catch(function (error) {
      throw error;
    })
}

export function* getChains() {
  try {
    const response = yield call(getChainsApi);
    yield put(fetchChainsSuccess(response));
  }
  catch (err) {
    yield put(fetchChainsFailure(err));
  }
}

export function* getChainsIds() {
  try {
    const response = yield call(getChainsApi);
    yield put(fetchChainIdsSuccess(response));
  }
  catch (err) {
    yield put(fetchChainIdsFailure(err));
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
    takeLatest(FETCH_CHAINS_REQUEST, getChains),
    takeLatest(FETCH_CHAIN_IDS_REQUEST, getChainsIds),
    takeEvery(FETCH_CHAIN_DETAIL_REQUEST, getChainDetail)
  ];
}
