import {
  takeLatest,
  takeEvery,
  put,
  call,
  cancelled
} from 'redux-saga/effects';
import {
  FETCH_CHAINS,
  fetchChainsSuccess,
  fetchChainsFailure
} from './chains.actions';
import { env } from '../../env';
import { hideLoading } from 'react-redux-loading-bar';

const chainUrl = env.STRATO_URL + "/chain"

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
    chainUrl.concat("?chainid=", chainid),
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
    //console.log("response");
    //console.log(response);
    const chainLabels = response.map(chainIdChainInfo => chainIdChainInfo["info"]["label"]);
    const chainIds = response.map(chainIdChainInfo => chainIdChainInfo["id"]);
    const chainInfos = response.map(chainIdChainInfo => chainIdChainInfo["info"]);
    yield put(fetchChainsSuccess(chainLabels, chainIds, chainInfos));
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
