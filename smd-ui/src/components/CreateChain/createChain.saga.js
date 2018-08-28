import {
  takeLatest,
  put,
  call
} from 'redux-saga/effects';
import {
  CREATE_CHAIN_REQUEST,
  createChainSuccess,
  createChainFailure,
} from './createChain.actions';

import {
  fetchChains
} from '../Chains/chains.actions';

import { env } from '../../env';

const url = env.BLOC_URL + "/chain"

export function createChainApiCall(label, members, balances, src, args){
  return fetch(
    url,
    {
      method: 'POST',
      credentials: "include",
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
         "args": args,
         "balances": balances,
         "members": members,
         "src": src,
         "label": label
      })
    }
  )
    .then(function (response) {
      return response;
    })
    .catch(function (error) {
      throw error;
    });
}

export function* createChain(action) {
  try {
    let response = yield call(createChainApiCall, action.label, action.members, action.balances, action.src, action.args);
    yield put(createChainSuccess(response));
    yield put(fetchChains());
  }
  catch (err) {
    yield put(createChainFailure(err));
  }
}

export default function* watchCreateChain() {
  yield takeLatest(CREATE_CHAIN_REQUEST, createChain);
}
