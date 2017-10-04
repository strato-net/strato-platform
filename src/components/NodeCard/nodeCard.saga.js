import {
  takeEvery,
  put,
  call
} from 'redux-saga/effects';
import {
  FETCH_NODE_DETAIL_REQUEST,
  FETCH_NODE_PEERS_REQUEST,
  FETCH_NODE_COINBASE_REQUEST,
  fetchNodeDetailSuccess,
  fetchNodeDetailFailure,
  fetchNodePeersSuccess,
  fetchNodePeersFailure,
  fetchNodeCoinbaseSuccess,
  fetchNodeCoinbaseFailure
} from './nodeCard.actions';
import { env } from '../../env';

// TODO: All of this can probably be refactored to be more concise

function getNodeDetailApi(){
  const detailUrl = env.STRATO_URL + '/uuid';
  return fetch(
    detailUrl,
    {
      method: 'GET',
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

function getNodePeersApi() {
  const peerUrl = env.STRATO_URL + '/peers';
  return fetch(
    peerUrl,
    {
      method: 'GET',
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

function getNodeCoinbaseApi() {
  const coinbaseUrl = env.STRATO_URL + '/coinbase';
  return fetch(
    coinbaseUrl,
    {
      method: 'GET',
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

function* getNodeDetail(action) {
  try {
    const response = yield call(getNodeDetailApi);
    yield put(fetchNodeDetailSuccess(action.nodeIndex, response));
  }
  catch(err) {
    yield put(fetchNodeDetailFailure(action.nodeIndex,err));
  }
}

function* getNodePeers(action) {
  try {
    const response = yield call(getNodePeersApi);
    yield put(fetchNodePeersSuccess(action.nodeIndex, response));
  }
  catch(err) {
    yield put(fetchNodePeersFailure(action.nodeIndex,err));
  }
}

function* getNodeCoinbase(action) {
  try {
    const response = yield call(getNodeCoinbaseApi);
    yield put(fetchNodeCoinbaseSuccess(action.nodeIndex, response.coinbase));
  }
  catch(err) {
    yield put(fetchNodeCoinbaseFailure(action.nodeIndex,err));
  }
}

export default function* watchFetchNodeData() {
  yield [
    takeEvery(FETCH_NODE_DETAIL_REQUEST, getNodeDetail),
    takeEvery(FETCH_NODE_PEERS_REQUEST, getNodePeers),
    takeEvery(FETCH_NODE_COINBASE_REQUEST, getNodeCoinbase)
  ]
}
