import {
  takeEvery,
  put,
  call
} from 'redux-saga/effects';
import {
  METHOD_CALL_REQUEST,
  methodCallSuccess,
  methodCallFailure,
} from './contractMethodCall.actions';
import { fetchState } from '../ContractCard/contractCard.actions';
import { env } from '../../../../env.js'
import { handleErrors } from '../../../../lib/handleErrors';
import { createUrl } from '../../../../lib/url';
import { isOauthEnabled } from '../../../../lib/checkMode';

export function postMethodCall(payload) {
  const isModeOauth = isOauthEnabled();
  const options = isModeOauth ? { query: { resolve: true, chainid: payload.chainId, use_wallet: payload.useWallet } } :
    {
      params: {
        username: payload.username,
        userAddress: payload.userAddress,
        contractName: payload.contractName,
        contractAddress: payload.contractAddress
      }, query: { resolve: true, chainid: payload.chainId }
    };

  const prefix = isModeOauth ? env.STRATO_URL_V23 : env.BLOC_URL;
  const url = prefix + createUrl(isModeOauth ? '/transaction' : '/users/::username/::userAddress/contract/::contractName/::contractAddress/call', options);

  const blocBody = {
    password: payload.password,
    method: payload.methodName,
    value: payload.value && !isNaN(parseFloat(payload.value)) ? parseFloat(payload.value) : 0,
    args: payload.args
  };

  const oauthBody = {
    "txs": [
      {
        "payload": {
          "contractName": payload.contractName,
          "contractAddress": payload.contractAddress,
          "value": payload.value,
          "method": payload.methodName,
          "args": payload.args,
          "metadata": {}
        },
        "type": "FUNCTION"
      }
    ]
  }

  const body = isModeOauth ? oauthBody : blocBody;

  return fetch(
    url,
    {
      method: 'POST',
      credentials: "include",
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })
    .then(handleErrors)
    .then(function (response) {
      return response.json();
    })
    .catch(function (error) {
      throw error;
    });
}

export function* methodCall(action) {
  try {
    const response = yield call(postMethodCall, action.payload);
    yield put(fetchState(action.payload.contractName, action.payload.contractAddress, action.payload.chainId));
    yield put(methodCallSuccess(action.key, response));
  }
  catch (err) {
    yield put(methodCallFailure(action.key, err));
  }
}

export function* watchMethodCall() {
  yield takeEvery(METHOD_CALL_REQUEST, methodCall);
}
