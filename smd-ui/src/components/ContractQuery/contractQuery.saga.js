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
  queryCirrusVarsFailure,
  queryCirrusAddressSuccess,
} from './contractQuery.actions';
import { env } from '../../env.js'
import { handleErrors } from '../../lib/handleErrors';
import { createUrl } from '../../lib/url';

const cirrusUrl = env.CIRRUS_URL + '/:contractName?:queryString';

export function queryCirrusRequest(name, queryString) {

  return fetch(
    cirrusUrl.replace(":contractName", name).replace(':queryString', queryString),
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
export function queryCirrusAddressRequest(contractName) {
  const url = `${env.BLOC_URL}/contracts/${contractName}`;

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
export function queryCirrusVarsRequest(contractName, contractAddress) {
  const options = { params: { contractName, contractAddress } };
  const url = env.BLOC_URL + createUrl('/contracts/::contractName/::contractAddress', options);

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
    const addressResponse = yield call(queryCirrusAddressRequest, action.contractName);
    yield put(queryCirrusAddressSuccess(addressResponse[0]));
    const varsResponse = yield call(queryCirrusVarsRequest, action.contractName, addressResponse[0]);
    yield put(queryCirrusVarsSuccess(varsResponse.xabi.vars));
  }
  catch (err) {
    yield put(queryCirrusVarsFailure(err))
  }
}

export function* queryCirrus(action) {
  try {
    const response = yield call(queryCirrusRequest, action.tableName, action.queryString);
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
