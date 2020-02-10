import {
  takeEvery,
  put,
  call
} from 'redux-saga/effects';
import {
  QUERY_CIRRUS_REQUEST,
  queryCirrusSuccess,
  queryCirrusFailure,
  QUERY_CIRRUS_VARS_REQUEST,
  queryCirrusVarsSuccess,
  queryCirrusVarsFailure
} from './contractQuery.actions';
import { env } from '../../env.js'
import { handleErrors } from '../../lib/handleErrors';
import { createUrl } from '../../lib/url';

const cirrusUrl = env.CIRRUS_URL + '/:contractName?:queryString:chainid';

export function queryCirrusRequest(name, queryString, chainId) {
  let chain;
  if (queryString === '') {
    chain = chainId ? `chainId=eq.${chainId}` : ``;
  } else {
    chain = chainId ? `&chainId=eq.${chainId}` : ``;
  }

  return fetch(
    cirrusUrl.replace(":contractName", name).replace(':queryString', queryString).replace(':chainid', chain),
    {
      method: 'GET',
      credentials: "include",
      headers: {
        'Accept': 'application/json'
      },
    })
    .then(handleErrors)
    .then(function (response) {
      return response.json()
    })
    .catch(function (error) {
      throw error;
    });
}

export function queryCirrusVarsRequest(contractName) {
  const options = { params: { contractName } };
  const url = env.BLOC_URL + createUrl('/contracts/:contractName/Latest', options);

  return fetch(
    url,
    {
      method: 'GET',
      credentials: "include",
      headers: {
        'Accept': 'application/json'
      },
    })
    .then(handleErrors)
    .then(function (response) {
      return response.json()
    })
    .catch(function (error) {
      throw error;
    });
}

export function* queryCirrusVars(action) {
  try {
    const response = yield call(queryCirrusVarsRequest, action.contractName);
    yield put(queryCirrusVarsSuccess(response.xabi.vars));
  }
  catch (err) {
    yield put(queryCirrusVarsFailure(err))
  }
}

export function* queryCirrus(action) {
  try {
    const response = yield call(queryCirrusRequest, action.contractName, action.queryString, action.chainId);
    yield put(queryCirrusSuccess(response));
  }
  catch (err) {
    yield put(queryCirrusFailure(err));
  }
}

export function* watchQueryCirrusVars() {
  yield takeEvery(QUERY_CIRRUS_VARS_REQUEST, queryCirrusVars);
}

export function* watchQueryCirrus() {
  yield takeEvery(QUERY_CIRRUS_REQUEST, queryCirrus);
}
