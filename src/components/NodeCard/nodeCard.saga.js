import {
  takeEvery,
  put,
  call
} from 'redux-saga/effects';
import {
  FETCH_NODE_DETAIL,
  FETCH_NODE_PEERS,
  FETCH_NODE_COINBASE,
  fetchNodeDetailSuccess,
  fetchNodeDetailFailure,
  fetchNodePeersSuccess,
  fetchNodePeersFailure,
  fetchNodeCoinbaseSuccess,
  fetchNodeCoinbaseFailure
} from './nodeCard.actions';
import {NODES} from '../../env';

// TODO: All of this can probably be refactored to be more concise

function getNodeDetailApi(nodeIndex){
  const detailUrl = NODES[nodeIndex].url + '/strato-api/eth/v1.2/uuid';
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

function getNodePeersApi(nodeIndex) {
  const peerUrl = NODES[nodeIndex].url + '/strato-api/eth/v1.2/peers';
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

function getNodeCoinbaseApi(nodeIndex) {
  const coinbaseUrl = NODES[nodeIndex].url + '/strato-api/eth/v1.2/coinbase';
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
    const response = yield call(getNodeDetailApi, action.nodeIndex);
    yield put(fetchNodeDetailSuccess(action.nodeIndex, response));
  }
  catch(err) {
    yield put(fetchNodeDetailFailure(action.nodeIndex,err));
  }
}

function* getNodePeers(action) {
  try {
    const response = yield call(getNodePeersApi, action.nodeIndex);
    yield put(fetchNodePeersSuccess(action.nodeIndex, response));
  }
  catch(err) {
    yield put(fetchNodePeersFailure(action.nodeIndex,err));
  }
}

function* getNodeCoinbase(action) {
  try {
    const response = yield call(getNodeCoinbaseApi, action.nodeIndex);
    yield put(fetchNodeCoinbaseSuccess(action.nodeIndex, response.coinbase));
  }
  catch(err) {
    yield put(fetchNodeCoinbaseFailure(action.nodeIndex,err));
  }
}

export default function* watchFetchNodeData() {
  yield [
    takeEvery(FETCH_NODE_DETAIL, getNodeDetail),
    takeEvery(FETCH_NODE_PEERS, getNodePeers),
    takeEvery(FETCH_NODE_COINBASE, getNodeCoinbase)
  ]
}
