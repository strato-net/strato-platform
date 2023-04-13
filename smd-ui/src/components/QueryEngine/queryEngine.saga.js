import {
  takeEvery,
  put,
  call
} from 'redux-saga/effects';
import {
  EXECUTE_QUERY_REQUEST,
  TRANSACTION_RESULT_REQUEST,
  executeQuerySuccess,
  executeQueryFailure,
  getTransactionResultSuccess,
  getTransactionResultFailure
} from './queryEngine.actions';
import { TRANSACTION_QUERY_TYPES } from './queryTypes';
import { env } from '../../env';
import { handleErrors } from '../../lib/handleErrors';

const url = env.STRATO_URL;

export function query(query, resourceType, chainId) {
  let constructedURL = url + resourceType;
  const queryParts = Object.getOwnPropertyNames(query);
  queryParts.forEach(function (part) {
    if (part === TRANSACTION_QUERY_TYPES.last.key) {
      return;
    }
    constructedURL += constructedURL.indexOf("?") > -1 ? "&" : "?";
    constructedURL += part + '=' + query[part];
  });
  if (queryParts.length === 1 && queryParts.indexOf(TRANSACTION_QUERY_TYPES.last.key) > -1) {
    constructedURL += '/last/' + query.last;
  }
  if (chainId) {
    const symbol = constructedURL.indexOf("?") > -1 ? "&" : "?";
    constructedURL += symbol + `chainId=${chainId}`;
  }
  return fetch(
    constructedURL,
    {
      method: 'GET',
      credentials: "include",
      headers: {
        'Accept': 'application/json'
      },
    }).then(handleErrors)
    .then(function (res) {
      return res.json();
    })
    .catch(function (error) {
      throw error;
    });
}

export function transactionResultRequest(txHash) {
  let queryUrl = `${url}/transactionResult/${txHash}`
  return fetch(queryUrl, {
          method: 'GET',
          credentials: "include",
          headers: {
            'Accept': 'application/json'
          }
        })
        .then(handleErrors)
        .then(res => res.json())
        .catch(error => {throw error;});
}

export function* executeQuery(action) {
  try {
    let response = yield call(query, action.query, action.resourceType, action.chainId);
    yield put(executeQuerySuccess(response));
  }
  catch (err) {
    yield put(executeQueryFailure(err));
  }
}

export function* getTransactionResult(action) {
  try {
    let response = yield call(transactionResultRequest, action.txHash);
    yield put(getTransactionResultSuccess(response));
  }
  catch (err) {
    yield put(getTransactionResultFailure(err));
  }
}

export function* watchExecuteQuery() {
  yield takeEvery(EXECUTE_QUERY_REQUEST, executeQuery);
}
export function* watchTransactionResult() {
  yield takeEvery(TRANSACTION_RESULT_REQUEST, getTransactionResult);
}