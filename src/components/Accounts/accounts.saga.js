import {
  takeLatest,
  takeEvery,
  put,
  call,
  cancelled
} from 'redux-saga/effects';
import {
  FETCH_ACCOUNTS,
  FETCH_ACCOUNT_ADDRESS_REQUEST,
  FETCH_ACCOUNT_DETAIL_REQUEST,
  fetchAccountsSuccess,
  fetchAccountsFailure,
  fetchUserAddresses,
  fetchUserAddressesSuccess,
  fetchUserAddressesFailure,
  fetchAccountDetail,
  fetchAccountDetailSuccess,
  fetchAccountDetailFailure,
  FAUCET_REQUEST,
  faucetSuccess,
  faucetFailure
} from './accounts.actions';
import { env } from '../../env';
import { hideLoading } from 'react-redux-loading-bar';
import { delay } from 'redux-saga';

const accountDataUrl = env.STRATO_URL + "/account?address=:address";
const addressUrl = env.BLOC_URL + '/users/:user';
const usernameUrl = env.BLOC_URL + "/users";
const faucetUrl = env.STRATO_URL + "/faucet"

export function getAccountsApi() {
  return fetch(
    usernameUrl,
    {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      },
    })
    .then(function (response) {
      return response.json()
    })
    .catch(function (error) {
      throw error;
    })
}

export function getUserAddressesApi(username) {
  return fetch(
    addressUrl.replace(':user', username),
    {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      },
    }
  )
    .then(function (response) {
      return response.json();
    })
    .catch(function (error) {
      throw error;
    });
}

export function getAccountDetailApi(address) {
  return fetch(
    accountDataUrl.replace(":address", address),
    {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      },
    }
  )
    .then(function (response) {
      return response.json();
    })
    .catch(function (error) {
      throw error;
    });
}

export function postFaucet(address) {
  return fetch(
    faucetUrl,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: `address=${address}`
    }
  )
    .then(function (response) {
      return;
    })
    .catch(function (error) {
      throw error;
    })
}

export function* getAccounts(action) {
  try {
    const response = yield call(getAccountsApi);
    yield put(fetchAccountsSuccess(response));
    // dispatch the action if necessary
    if (action.loadAddresses && response.length > 0) {
      yield put(fetchUserAddresses(response[0], action.loadBalances));
    }
  }
  catch (err) {
    yield put(fetchAccountsFailure(err));
  } finally {
    if (yield cancelled()) {
      yield put(hideLoading());
    }
  }
}

export function* getUserAddresses(action) {
  try {
    const response = yield call(getUserAddressesApi, action.name);
    yield put(fetchUserAddressesSuccess(action.name, response));
    if (action.loadBalances) {
      yield response.map(address => put(fetchAccountDetail(action.name, address)));
    }
  }
  catch (err) {
    yield put(fetchUserAddressesFailure(action.name, err));
  }
}

export function* getAccountDetail(action) {
  try {
    const response = yield call(getAccountDetailApi, action.address);
    // don't ask about response['0'].
    yield put(fetchAccountDetailSuccess(action.name, action.address, response['0']));
  }
  catch (err) {
    yield put(fetchAccountDetailFailure(action.name, action.address, err));
  }
}

export function* faucetAccount(action) {
  try {
    yield call(postFaucet, action.address);
    yield put(faucetSuccess());
    yield call(delay, 100)
    yield put(fetchAccountDetail(action.name, action.address));
  }
  catch (err) {
    yield put(faucetFailure(err))
  }
}

export default function* watcAccountActions() {
  yield [
    takeLatest(FETCH_ACCOUNTS, getAccounts),
    takeEvery(FETCH_ACCOUNT_ADDRESS_REQUEST, getUserAddresses),
    takeEvery(FETCH_ACCOUNT_DETAIL_REQUEST, getAccountDetail),
    takeLatest(FAUCET_REQUEST, faucetAccount)
  ];
}
