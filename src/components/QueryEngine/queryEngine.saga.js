import {
  takeEvery,
  put,
  call
} from 'redux-saga/effects';
import {
  EXECUTE_QUERY,
  executeQuerySuccess,
  executeQueryFailure
} from './queryEngine.actions';
import { TRANSACTION_QUERY_TYPES } from './queryTypes';
import { env } from '../../env';

const url = env.STRATO_URL;

function query(query, resourceType) {
  let constructedURL = url + resourceType;
  const queryParts = Object.getOwnPropertyNames(query);
  queryParts.forEach(function(part) {
      if (part === TRANSACTION_QUERY_TYPES.last.key) {
        return;
      }
      constructedURL += constructedURL.indexOf("?") > -1 ? "&" : "?";
      constructedURL += part + '=' + query[part];
    });
  if (queryParts.length === 1 && queryParts.indexOf(TRANSACTION_QUERY_TYPES.last.key) > -1) {
    constructedURL += '/last/' + query.last;
  }
  return fetch(
    constructedURL,
    {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      },
    })
    .then(function (response) {
      return response.json();
    })
    .then(function (res) {
      return res;
    })
    .catch(function (error) {
      throw error;
    });
}

function* executeQuery(action) {
  try {
    let response = yield call(query, action.query, action.resourceType);
    yield put(executeQuerySuccess(response));
  }
  catch (err) {
    yield put(executeQueryFailure(err));
  }
}

export default function* watchExecuteQuery() {
  yield takeEvery(EXECUTE_QUERY, executeQuery);
}
