import {
  takeLatest,
  takeEvery,
  put,
  call,
  cancelled
} from 'redux-saga/effects';
import {
  FETCH_CHAINS,
  FETCH_CHAIN_ID_REQUEST,
  FETCH_CHAIN_DETAIL_REQUEST,
  fetchChainsSuccess,
  fetchChainsFailure,
  fetchChainId,
  fetchChainIdSuccess,
  fetchChainIdFailure,
  fetchChainDetail,
  fetchChainDetailSuccess,
  fetchChainDetailFailure
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
    // const response = yield call(getChainsApi);
    // const chainLabels = response.map(chainIdChainInfo => chainIdChainInfo["info"]["label"]);
    // const chainIds = response.map(chainIdChainInfo => chainIdChainInfo["id"]);
    // const chainInfos = response.map(chainIdChainInfo => chainIdChainInfo["info"]);
    const chainLabels = ["c1","c2"];
    const chainIds = ["5ee7e72b5ee72c93607998c15efe8d5fe1f00b1dfc9e051f3c6cad79a3b489ac", "5874fceb96c31fdcab63bfb3b0026efef45c188d14762eee8ecfb36df849792f"];
    yield put(fetchChainsSuccess(chainLabels, chainIds));
    if (action.loadChainId && chainLabels.length > 0) {
      yield put(fetchChainId(chainLabels[0], chainLabels, chainIds, action.loadChainId));
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

export function* getChainId(action) {
  try {
    let labelIndex = action.labelList.indexOf(action.label);
    let id = action.idList[labelIndex];
    yield put(fetchChainIdSuccess(action.label, id));
    if (action.loadDetails) {
      yield put(fetchChainDetail(action.label, id));
    }
  }
  catch (err) {
    yield put(fetchChainIdFailure(action.label, err));
  }
}

export function* getChainDetail(action) {
  try {
    // const response = yield call(getChainDetailApi, action.id);
    const response = {
      "balances": [
        {
          "balance": 0,
          "address": "0000000000000000000000000000000000000100"
        },
        {
          "balance": 20000000,
          "address": "5815b9975001135697b5739956b9a6c87f1c575c"
        },
        {
          "balance": 999999,
          "address": "93fdd1d21502c4f87295771253f5b71d897d911c"
        }
      ],
      "members": [
        {
          "address": "5815b9975001135697b5739956b9a6c87f1c575c",
          "enode": "enode://6d8a80d14311c39f35f516fa664deaaaa13e85b2f7493f37f6144d86991ec012937307647bd3b9a82abe2974e1407241d54947bbb39763a4cac9f77166ad92a0@171.16.0.4:30303"
        },
        {
          "address": "93fdd1d21502c4f87295771253f5b71d897d911c",
          "enode": "enode://6f8a80d14311c39f35f516fa664deaaaa13e85b2f7493f37f6144d86991ec012937307647bd3b9a82abe2974e1407241d54947bbb39763a4cac9f77166ad92a0@172.16.0.5:30303?discport=30303"
        }
      ],
      "label": "c1"
    };
    yield put(fetchChainDetailSuccess(action.label, action.id, response));
  }
  catch (err) {
    yield put(fetchChainDetailFailure(action.label, action.id, err));
  }
}

export default function* watchFetchChains() {
  yield [
    takeLatest(FETCH_CHAINS, getChains),
    takeEvery(FETCH_CHAIN_ID_REQUEST, getChainId),
    takeEvery(FETCH_CHAIN_DETAIL_REQUEST, getChainDetail)
  ];
}
