import {
  takeEvery,
  put,
  call
} from 'redux-saga/effects';
import {
  FETCH_STATE_REQUEST,
  FETCH_CIRRUS_INSTANCES_REQUEST,
  FETCH_ACCOUNT_REQUEST,
  fetchStateSuccess,
  fetchStateFailure,
  fetchCirrusInstancesSuccess,
  fetchCirrusInstancesFailure,
  fetchAccountSuccess,
  fetchAccountFailure
} from './contractCard.actions';
import { env } from '../../../../env.js'
import { handleErrors } from '../../../../lib/handleErrors';
import { createUrl } from '../../../../lib/url';

const contractsUrl = env.BLOC_URL + "/contracts/:contractName/:contractAddress/state";
const cirrusUrl = env.CIRRUS_URL + '/:contractName'
const accountUrl = env.STRATO_URL + '/account'

export function getState(contractName, contractAddress, chainid) {
  const options = { params: { contractName, contractAddress }, query: { chainid } };
  const url = createUrl(contractsUrl, options);

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

export function getCirrusInstances(contractName) {
  const options = { params: { contractName } };
  const url = createUrl(cirrusUrl, options);

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
      if (response.status === 404) {
        throw new Error('No dice!')
      }
      return response.json()
    })
    .catch(function (error) {
      throw error;
    });
}

export function getAccount(address) {
  const options = { query: { address } };
  const url = createUrl(accountUrl, options);

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
      return response.json();
    }).catch(function (error) {
      throw error;
    });
}

export function* fetchState(action) {
  try {
    let response = yield call(getState, action.name, action.address, action.chainId);
    yield put(fetchStateSuccess(action.name, action.address, response));
  }
  catch (err) {
    yield put(fetchStateFailure(err));
  }
}

export function* fetchCirrusInstances(action) {
  try {
    let response = yield call(getCirrusInstances, action.name);
    yield put(fetchCirrusInstancesSuccess(action.name, response));
  }
  catch (err) {
    yield put(fetchCirrusInstancesFailure(action.name, err));
  }
}

export function* fetchAccount(action) {
  try {
    let response = yield call(getAccount, action.address);
    yield put(fetchAccountSuccess(action.name, action.address, response));
  }
  catch (err) {
    yield put(fetchAccountFailure(action.name, action.address, err));
  }
}

export function* watchFetchCirrusContracts() {
  yield takeEvery(FETCH_CIRRUS_INSTANCES_REQUEST, fetchCirrusInstances);
}

export function* watchFetchState() {
  yield takeEvery(FETCH_STATE_REQUEST, fetchState);
}

export function* watchAccount() {
  yield takeEvery(FETCH_ACCOUNT_REQUEST, fetchAccount);
}
