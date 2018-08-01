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
  let bd = {
  "args": [],
  "balances": [
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
  "src": "contract Governance { }",
  "label": "my chain"
  };
  return fetch(
    url,
    {
      method: 'POST',
      credentials: "include",
      headers: {
        'Content-Type': 'application/json'
      },
      body: bd
      // JSON.stringify({
      //   "src": src,
      //   "label": label,
      //   "balances": [balances],
      //   "args": [],
      //   "members": [members]
      // }
      )
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
    console.log(response);
    yield put(createChainSuccess(response));
    yield put(fetchChains(false));
  }
  catch (err) {
    yield put(createChainFailure(err));
  }
}

export default function* watchCreateChain() {
  yield takeLatest(CREATE_CHAIN_REQUEST, createChain);
}
