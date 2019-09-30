import {
  takeEvery,
  put,
  call
} from 'redux-saga/effects';
import {
  METHOD_CALL_REQUEST,
  methodCallSuccess,
  methodCallFailure,
  METHOD_CALL_FETCH_ARGS_REQUEST,
  methodCallFetchArgsSuccess,
  methodCallFetchArgsFailure
} from './contractMethodCall.actions';
import { fetchState } from '../ContractCard/contractCard.actions';
import { env } from '../../../../env.js'
import { handleErrors } from '../../../../lib/handleErrors';
import { isOauthEnabled } from '../../../../lib/checkMode';

const contractsUrl = env.BLOC_URL + "/contracts/:contractName/:contractAddress?:chainid";
const blocMethodUrl = env.BLOC_URL + "/users/:username/:userAddress/contract/:contractName/:contractAddress/call?resolve&:chainid";
const transactionUrl = env.STRATO_URL_V23 + "/transaction?resolve=true&:chainid"

export function getArgs(contractName, contractAddress, symbol, chainId) {
  const localContractUrl = contractsUrl.replace(':contractName', contractName).replace(':contractAddress', contractAddress);
  return fetch(
    chainId ? localContractUrl.replace(":chainid", `chainid=${chainId}`) : localContractUrl.replace("?:chainid", ''),
    {
      method: 'GET',
      credentials: "include",
      headers: {
        'Accept': 'application/json'
      },
    })
    .then(handleErrors)
    .then(function (response) {
      return response.json();
    })
    .catch(function (error) {
      throw error;
    });
}

export function postMethodCall(payload) {
  const localMethodUrl = blocMethodUrl
    .replace(':username', payload.username)
    .replace(':userAddress', payload.userAddress)
    .replace(":contractName", payload.contractName)
    .replace(":contractAddress", payload.contractAddress);

  const methodUrl = payload.chainId ? localMethodUrl.replace(":chainid", `chainid=${payload.chainId}`) : localMethodUrl.replace("&:chainid", '');
  const oauthUrl = payload.chainId ? transactionUrl.replace(":chainid", `chainid=${payload.chainId}`) : transactionUrl.replace("&:chainid", '');

  const url = isOauthEnabled() ? oauthUrl : methodUrl;

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

  const body = isOauthEnabled() ? oauthBody : blocBody;

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
    yield put(fetchState(action.payload.contractName, action.payload.contractAddress));
    yield put(methodCallSuccess(action.key, JSON.stringify(response, null, 2)));
  }
  catch (err) {
    yield put(methodCallFailure(action.key, err));
  }
}

export function* fetchArgs(action) {
  try {
    const response = yield call(getArgs, action.name, action.address, action.symbol, action.chainId);
    const args = response.xabi.funcs[action.symbol].args;
    yield put(methodCallFetchArgsSuccess(action.key, args));
  }
  catch (err) {
    yield put(methodCallFetchArgsFailure(action.key, err));
  }
}

export function* watchMethodCall() {
  yield takeEvery(METHOD_CALL_REQUEST, methodCall);
}

export function* watchFetchArgs() {
  yield takeEvery(METHOD_CALL_FETCH_ARGS_REQUEST, fetchArgs);
}
