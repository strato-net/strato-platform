import {
  takeLatest,
  put,
  call
} from 'redux-saga/effects';
import { delay } from "redux-saga"
import {
  CREATE_CHAIN_REQUEST,
  createChainSuccess,
  createChainFailure,
} from './createChain.actions';

import {
  fetchChains,
  fetchChainIds
} from '../Chains/chains.actions';

import { env } from '../../env';
import { handleErrors } from '../../lib/handleErrors';

const url = env.BLOC_URL + "/chain"

export function createChainApiCall(label, members, balances, integrations, src, args, vm, contractName) {
  return fetch(
    url,
    {
      method: 'POST',
      credentials: "include",
      headers: {
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({
        "contract": contractName,
        "args": args,
        "balances": balances,
        "members": members,
        "parentChains": integrations,
        "src": src,
        "label": label,
        "metadata": {
          VM: vm ? 'SolidVM' : 'EVM' 
        }
      })
    }
  )
    .then(handleErrors)
    .then(function (response) {
      if (response.status !== 200) {
        return response.text().then(error => {
          throw error
        })
      }
      return response;
    })
    .catch(function (error) {
      throw error;
    });
}

export function* createChain(action) {
  try {
    let response = yield call(createChainApiCall, action.label, action.members, action.balances, action.integrations, action.src, action.args, action.vm, action.contractName);
    // TODO: Change when when we start getting actual error messages
    if (response.status === 200) {
      yield put(createChainSuccess(response));
      yield call(delay, 2000);
      yield put(fetchChains(action.limit, action.offset));
      yield put(fetchChainIds())
    } else {
      yield put(createChainFailure(response));
    }
  }
  catch (err) {
    yield put(createChainFailure(err));
  }
}

export default function* watchCreateChain() {
  yield takeLatest(CREATE_CHAIN_REQUEST, createChain);
}
