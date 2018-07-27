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

export function createChainApiCall(src, label, acctInfo, vars, members){
  return fetch(
    {
      method: 'POST',
      credentials: "include",
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        "chainInputSrc": src,
        "chainInputLabel": label,
        "chainInputAccountInfo": acctInfo,
        "chainInputVariableValues": vars,
        "chainInputMembers": members
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
    let response = yield call(createChainApiCall, action.src, action.label, action.acctInfo, action.vars, action.members);
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
