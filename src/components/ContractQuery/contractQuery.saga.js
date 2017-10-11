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

const cirrusUrl = env.CIRRUS_URL + '/:contractName?:queryString';
const contractUrl = env.BLOC_URL + '/contracts/:contractName/Latest';

function queryCirrusRequest(name, queryString) {
  return fetch(
    cirrusUrl.replace(":contractName", name).replace(':queryString',queryString),
    {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      },
    })
    .then(function(response) {
      return response.json()
    })
    .catch(function(error) {
      throw error;
    });
}

function queryCirrusVarsRequest(contractName) {
  return fetch(
    contractUrl.replace(":contractName", contractName),
    {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      },
    })
    .then(function(response) {
      return response.json()
    })
    .catch(function(error) {
      throw error;
    });
}

function* queryCirrusVars(action) {
  try {
    const response = yield call(queryCirrusVarsRequest, action.contractName);
    yield put(queryCirrusVarsSuccess(response.xabi.vars));
  }
  catch(err) {
    yield put(queryCirrusVarsFailure(err))
  }
}

function* queryCirrus(action){
  try {
    const response = yield call(queryCirrusRequest, action.contractName, action.queryString);
    yield put(queryCirrusSuccess(response));
  }
  catch(err) {
    yield put(queryCirrusFailure(err));
  }
}

export function* watchQueryCirrusVars() {
  yield takeEvery(QUERY_CIRRUS_VARS_REQUEST, queryCirrusVars);
}

export function* watchQueryCirrus() {
  yield takeEvery(QUERY_CIRRUS_REQUEST, queryCirrus);
}
