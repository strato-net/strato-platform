import {
  takeLatest,
  takeEvery,
  put,
  call
} from 'redux-saga/effects';
import {
  FETCH_ACCOUNTS,
  FETCH_USER_ADDRESSES,
  FETCH_ACCOUNT_DETAIL,
  fetchAccountsSuccess,
  fetchAccountsFailure,
  fetchUserAddresses,
  fetchUserAddressesSuccess,
  fetchUserAddressesFailure,
  fetchAccountDetail,
  fetchAccountDetailSuccess,
  fetchAccountDetailFailure
} from './accounts.actions';
import {NODES} from '../../env';

const accountDataUrl = NODES[0].url + "/strato-api/eth/v1.2/account?address=:address";
const addressUrl = NODES[0].url + '/bloc/v2.1/users/:user';
const usernameUrl = NODES[0].url + "/bloc/v2.1/users";

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

function* getAccounts(action) {
  try {
    const response = yield call(getAccountsApi);
    yield put(fetchAccountsSuccess(response));
    // dispatch the action
    yield response.map(account => put(fetchUserAddresses(account)));
  }
  catch (err) {
    yield put(fetchAccountsFailure(err));
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

export default function* watchFetchAccounts() {
  yield [
    takeLatest(FETCH_ACCOUNTS, getAccounts),
    takeEvery(FETCH_USER_ADDRESSES, getUserAddresses),
    takeEvery(FETCH_ACCOUNT_DETAIL, getAccountDetail)
  ];
}
