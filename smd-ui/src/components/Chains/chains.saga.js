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

const chainUrl = env.BLOC_URL + "/chain"

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
    const response = [{
      "id": "id1",
      "info": {
        "label": "myChain",
        "addRule": "majorityRules",
        "removeRule": "majorityRules",
        "members": ["enode://6d8a80d14311c39f35f516fa664deaaaa13e85b2f7493f37f6144d86991ec012937307647bd3b9a82abe2974e1407241d54947bbb39763a4cac9f77166ad92a0@171.16.0.4:30303",
        "enode://6f8a80d14311c39f35f516fa664deaaaa13e85b2f7493f37f6144d86991ec012937307647bd3b9a82abe2974e1407241d54947bbb39763a4cac9f77166ad92a0@172.16.0.5:30303?discport=30303"],
        "balances": [{"address":"5815b9975001135697b5739956b9a6c87f1c575c", "balance":1999999999999999977},
        {"address":"93fdd1d21502c4f87295771253f5b71d897d911c", "balance":2000}]
      }},
      {
      "id": "id2",
      "info": {
        "label": "yourChain",
        "addRule": "majorityRules",
        "removeRule": "majorityRules",
        "members": ["enode://6d8a80d14311c39f35f516fa664deaaaa13e85b2f7493f37f6144d86991ec012937307647bd3b9a82abe2974e1407241d54947bbb39763a4cac9f77166ad92a0@171.16.0.4:30303",
        "enode://6f8a80d14311c39f35f516fa664deaaaa13e85b2f7493f37f6144d86991ec012937307647bd3b9a82abe2974e1407241d54947bbb39763a4cac9f77166ad92a0@172.16.0.5:30303?discport=30303"],
        "balances": [{"address":"5815b9975001135697b5739956b9a6c87f1c575c", "balance":1999999999999999977},
        {"address":"93fdd1d21502c4f87295771253f5b71d897d911c", "balance":2000}]
      }}
    ];
    const chainLabels = response.map(chainIdChainInfo => chainIdChainInfo["info"]["label"]);
    const chainIds = response.map(chainIdChainInfo => chainIdChainInfo["id"]);
    const chainInfos = [];
    response.forEach(function(value, index){
      chainInfos.push(value["info"]);
    });
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
