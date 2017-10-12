import {
  takeLatest,
  takeEvery,
  put,
  call,
  cancelled
} from 'redux-saga/effects';
import {
  FETCH_ACCOUNTS,
  FETCH_ACCOUNT_ADDRESS,
  FETCH_ACCOUNT_DETAIL,
  fetchAccountsSuccess,
  fetchAccountsFailure,
  fetchUserAddresses,
  fetchUserAddressesSuccess,
  fetchUserAddressesFailure,
  fetchAccountDetail,
  fetchAccountDetailSuccess,
  fetchAccountDetailFailure,
  FAUCET_REQUEST,
  FAUCET_SUCCESS,
  faucetSuccess,
  faucetFailure
} from './accounts.actions';
import { env } from '../../env';
import { hideLoading } from 'react-redux-loading-bar';

const accountDataUrl = env.STRATO_URL + "/account?address=:address";
const addressUrl = env.BLOC_URL + '/users/:user';
const usernameUrl = env.BLOC_URL + "/users";
const faucetUrl = env.STRATO_URL + "/faucet"

function getAccountsApi() {
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

function getUserAddressesApi(username) {
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

function getAccountDetailApi(address) {
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

function postFaucet(address) {
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
  .then(function(response) {
    console.log(response);
    return;
  })
  .catch(function(error) {
    throw error;
  })
}

function* getAccounts(action) {
  try {
    const response = yield call(getAccountsApi);
    yield put(fetchAccountsSuccess(response));
    // dispatch the action
    yield response.map(account => put(fetchUserAddresses(account)));
  }
  catch (err) {
    yield put(fetchAccountsFailure(err));
  } finally {
    if (yield cancelled()){
      yield put(hideLoading());
    }
  }
}

function* getUserAddresses(action) {
  try {
    const response = yield call(getUserAddressesApi, action.name);
    yield put(fetchUserAddressesSuccess(action.name, response));
    yield response.map(address => put(fetchAccountDetail(action.name,address)));
  }
  catch(err) {
    yield put(fetchUserAddressesFailure(action.name,err));
  }
}

function* getAccountDetail(action) {
  try {
    const response = yield call(getAccountDetailApi, action.address);
    // don't ask about response['0'].
    yield put(fetchAccountDetailSuccess(action.name, action.address, response['0']));
  }
  catch(err) {
    yield put(fetchAccountDetailFailure(action.name, action.address, err));
  }
}

function* faucetAccount(action) {
  try {
    yield call(postFaucet, action.address);
    yield put(faucetSuccess());
  }
  catch(err) {
    yield put(faucetFailure(err))
  }
}

export default function* watcAccountActions() {
  yield [
    takeLatest(FETCH_ACCOUNTS, getAccounts),
    takeLatest(FAUCET_SUCCESS, getAccounts),
    takeEvery(FETCH_ACCOUNT_ADDRESS, getUserAddresses),
    takeEvery(FETCH_ACCOUNT_DETAIL, getAccountDetail),
    takeLatest(FAUCET_REQUEST, faucetAccount)
  ];
}
