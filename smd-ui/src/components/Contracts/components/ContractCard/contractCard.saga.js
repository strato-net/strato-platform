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
  fetchAccountFailure,
  FETCH_CONTRACT_INFO_REQUEST,
  fetchContractInfoSuccess,
  fetchContractInfoFailure
} from './contractCard.actions';
import { env } from '../../../../env.js'
import { handleErrors } from '../../../../lib/handleErrors';
import { createUrl } from '../../../../lib/url';

export function getState(contractName, contractAddress, chainId) {
  const options = { params: { contractName, contractAddress }, query: { chainid: chainId } };
  const url = env.BLOC_URL + createUrl("/contracts/::contractName/::contractAddress/state", options);

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

export function getCirrusInstances(contractName, chainId) {
  let url = `${env.CIRRUS_URL}/${contractName}`;
  if (chainId) {
    url = `${url}?chainId=eq.${chainId}`;
  }
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
  const url = env.STRATO_URL + createUrl("/account", options);

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

export function getContract(contractName, contractAddress, chainid) {
  const options = { params: { contractName, contractAddress }, query: { chainid } };
  const url = env.BLOC_URL + createUrl("/contracts/::contractName/::contractAddress", options);

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
    })
    .catch(function (error) {
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
    let response = yield call(getCirrusInstances, action.name, action.chainId);
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

export function* fetchContractInfo(action) {
  try {
    const response = yield call(getContract, action.contractName, action.contractAddress, action.chainId);
    const data = { contract: response, name: action.contractName, address: action.contractAddress, chainId: action.chainId };
    yield put(fetchContractInfoSuccess(action.key, data));
  }
  catch (err) {
    yield put(fetchContractInfoFailure(action.key, err));
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

export function* watchFetchInfo() {
  yield takeEvery(FETCH_CONTRACT_INFO_REQUEST, fetchContractInfo);
}
