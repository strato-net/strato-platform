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
  GET_BALANCE,
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
  faucetFailure,
  fetchBalanceSuccess,
  fetchBalanceFailure,
  fetchCurrentAccountDetailSuccess,
  fetchCurrentAccountDetailFailure,
  FETCH_CURRENT_ACCOUNT_DETAIL_REQUEST,
  FETCH_OAUTH_ACCOUNTS_REQUEST,
  fetchOauthAccountsSuccess,
  fetchOauthAccountsFailure
} from './accounts.actions';
import { env } from '../../env';
import { hideLoading } from 'react-redux-loading-bar';
import { delay } from 'redux-saga';
import { handleErrors } from '../../lib/handleErrors';
import { createUrl } from '../../lib/url';

const oauthAccountDataUrl = env.STRATO_URL_V23 + "/users";
const accountDataUrl = env.STRATO_URL + "/account";
const addressUrl = env.BLOC_URL + '/users/:user';
const usernameUrl = env.BLOC_URL + "/users";
const faucetUrl = env.BLOC_URL + "/users/:user/:address/fill"

export function getAccountsApi() {
  return fetch(
    usernameUrl,
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
    })
}

export function getUserAddressesApi(username) {
  const options = { params: { user: username } };
  const url = createUrl(addressUrl, options);

  return fetch(
    url,
    {
      method: 'GET',
      credentials: "include",
      headers: {
        'Accept': 'application/json'
      },
    }
  )
    .then(handleErrors)
    .then(function (response) {
      return response.json();
    })
    .catch(function (error) {
      throw error;
    });
}

export function getAccountDetailApi(address, chainid) {
  const options = { query: { address, chainid } };
  const url = createUrl(accountDataUrl, options);

  return fetch(
    url,
    {
      method: 'GET',
      credentials: "include",
      headers: {
        'Accept': 'application/json'
      },
    }
  )
    .then(handleErrors)
    .then(function (response) {
      return response.json();
    })
    .catch(function (error) {
      throw error;
    });
}

export function postFaucet(username, address) {
  const options = { params: { user: username, address }, query: { resolve: true } };
  const url = createUrl(faucetUrl, options);

  return fetch(
    url,
    {
      method: 'POST',
      credentials: "include",
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }
  )
    .then(handleErrors)
    .then(function (response) {
      return;
    })
    .catch(function (error) {
      throw error;
    })
}

export function getOauthAccountsApi() {
  // strato URL add limit and offset if needed
  return fetch(
    oauthAccountDataUrl,
    {
      method: 'GET',
      credentials: "include",
      headers: {
        'Accept': 'application/json'
      },
    }
  )
    .then(handleErrors)
    .then(function (response) {
      return response.json();
    })
    .catch(function (error) {
      throw error;
    });
}

export function* getAccounts(action) {
  try {
    const response = yield call(getAccountsApi);
    // const response = ["sz1152", "sz2699"];
    yield put(fetchAccountsSuccess(response));
    // dispatch the action if necessary
    if (action.loadAddresses && response.length > 0) {
      yield put(fetchUserAddresses(response[0], action.loadBalances, action.chainId));
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
    // const response = ["999"];
    yield put(fetchUserAddressesSuccess(action.name, response));
    if (action.loadBalances) {
      yield response.map(address => put(fetchAccountDetail(action.name, address, action.chainId)));
    }
  }
  catch (err) {
    yield put(fetchUserAddressesFailure(action.name, err));
  }
}

export function* getAccountDetail(action) {
  try {
    const response = yield call(getAccountDetailApi, action.address, action.chainId);
    // don't ask about response['0'].
    yield put(fetchAccountDetailSuccess(action.name, action.address, response['0']));
    if (action.flag)
      yield put(faucetSuccess());
  }
  catch (err) {
    yield put(fetchAccountDetailFailure(action.name, action.address, err));
  }
}

export function* getCurrentAccountDetail(action) {
  try {
    const response = yield call(getAccountDetailApi, action.address);
    // don't ask about response['0'].
    yield put(fetchCurrentAccountDetailSuccess(action.address, response['0']));
  }
  catch (err) {
    yield put(fetchCurrentAccountDetailFailure(action.address, err));
  }
}

export function* faucetAccount(action) {
  try {
    yield call(postFaucet, action.name, action.address);
    yield call(delay, 100)
    yield put(fetchAccountDetail(action.name, action.address, action.chainId, action.flag));
    if (!action.flag)
      yield put(faucetSuccess());
  }
  catch (err) {
    yield put(faucetFailure(err))
  }
}

export function* getBalance(action) {
  try {
    const response = yield call(getAccountDetailApi, action.address);
    yield put(fetchBalanceSuccess(response['0']));
  }
  catch (err) {
    yield put(fetchBalanceFailure(err));
  }
}

export function* getOauthAccounts() {
  try {
    const response = yield call(getOauthAccountsApi);
    yield put(fetchOauthAccountsSuccess(response));
  }
  catch (err) {
    yield put(fetchOauthAccountsFailure('failed to fetch oauth accounts'));
  }
}

export default function* watcAccountActions() {
  yield [
    takeLatest(FETCH_ACCOUNTS, getAccounts),
    takeEvery(FETCH_ACCOUNT_ADDRESS_REQUEST, getUserAddresses),
    takeEvery(FETCH_ACCOUNT_DETAIL_REQUEST, getAccountDetail),
    takeEvery(FETCH_CURRENT_ACCOUNT_DETAIL_REQUEST, getCurrentAccountDetail),
    takeLatest(FAUCET_REQUEST, faucetAccount),
    takeEvery(GET_BALANCE, getBalance),
    takeEvery(FETCH_OAUTH_ACCOUNTS_REQUEST, getOauthAccounts)
  ];
}
