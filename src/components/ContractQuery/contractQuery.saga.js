import {
  takeEvery,
  put,
  call
} from 'redux-saga/effects';
import {
  QUERY_CIRRUS,
  queryCirrusSuccess,
  queryCirrusFailure
} from './contractQuery.actions';
import { env } from '../../env.js'

const cirrusUrl = env.CIRRUS_URL + '/:contractName'

function queryCirrusRequest(name, queryString) {
  return fetch(
    cirrusUrl.replace(":contractName", name) + queryString,
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

function* queryCirrus(action){
  try {
    const response = yield call(queryCirrusRequest, action.contractName, action.queryString);
    yield put(queryCirrusSuccess(response));
  }
  catch(err) {
    yield put(queryCirrusFailure(err));
  }
}

export default function* watchQueryCirrus() {
  yield takeEvery(QUERY_CIRRUS, queryCirrus);
}
