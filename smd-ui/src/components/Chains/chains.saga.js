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
  FETCH_CHAIN_IDS_REQUEST,
  fetchChainDetailSelectSuccess,
  fetchChainDetailSelectFailure,
  FETCH_SELECT_CHAIN_DETAIL_REQUEST
} from './chains.actions';
import { env } from '../../env';
import { handleErrors } from '../../lib/handleErrors';
import { createUrl } from '../../lib/url';

const stratoChainUrl = env.STRATO_URL + "/chain";
// const blocChainUrl = env.BLOC_URL + "/chain";

export function getChainsApi(limit, offset, chainid) {
  const url = createUrl(stratoChainUrl, { 
    query: { 
      limit : limit ? limit : undefined, 
      offset: limit ? offset : undefined, 
      chainid
    }
  })
  
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

export function getChainDetailApi(chainid) {
  const options = { query: { chainid } };
  const url = createUrl(stratoChainUrl, options);

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
export function getChainDetailApiWithQuery(query, queryField) {
  const options = { 
    query: { 
      [queryField]: query 
    }
  };
  const url = createUrl(stratoChainUrl, options);

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

export function* getChains(action) {
  try {
    const response = yield call(getChainsApi, action.limit, action.offset, action.chainid);
    yield put(fetchChainsSuccess(response));
  }
  catch (err) {
    yield put(fetchChainsFailure(err));
  }
}

export function* getChainsIds(action) {
  try {
    const response = yield call(getChainsApi, action.limit, action.offset);
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

export function* getChainDetailSelect(action) {
  try {
    const response = yield call(getChainDetailApiWithQuery, action.query, action.queryField);
    yield put(fetchChainDetailSelectSuccess(response));
  }
  catch (err) {
    yield put(fetchChainDetailSelectFailure(err));
  }
}

export default function* watchFetchChains() {
  yield [
    takeLatest(FETCH_CHAINS_REQUEST, getChains),
    takeLatest(FETCH_CHAIN_IDS_REQUEST, getChainsIds),
    takeEvery(FETCH_CHAIN_DETAIL_REQUEST, getChainDetail),
    takeEvery(FETCH_SELECT_CHAIN_DETAIL_REQUEST, getChainDetailSelect)
  ];
}
