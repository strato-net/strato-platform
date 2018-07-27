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

const url = env.STRATO_URL + "/chain"

export function createChainApiCall(label, addRule, removeRule, members, acctBalance){
  return fetch(
    {
      method: 'POST',
      credentials: "include",
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        "chainLabel": label,
        "addRule": addRule,
        "removeRule": removeRule,
        "members": members,
        "accountBalance": acctBalance
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
    let response = yield call(createChainApiCall, action.label, action.addRule, action.removeRule, action.members, action.acctBalance);
    yield put(createChainSuccess(response));
    yield put(fetchChains(false, false));
  }
  catch (err) {
    yield put(createChainFailure(err));
  }
}

export default function* watchCreateChain() {
  yield takeLatest(CREATE_CHAIN_REQUEST, createChain);
}
