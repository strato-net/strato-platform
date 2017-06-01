import {
  takeEvery,
  put,
  call
} from 'redux-saga/effects';
import {
  FETCH_ACCOUNTS,
  fetchAccountsSuccess,
  fetchAccountsFailure
} from './accounts.actions';
import {APIURL} from '../../env';

const accountDataUrl = APIURL + "strato-api/eth/v1.2/account?address=:address";
const addressUrl = APIURL + 'bloc/users/:user';
const usernameUrl = APIURL + "bloc/users";

function getAccounts() {
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
    .then(res => {
      return Promise.all(userAdresses(res));
    })
    .then(res => {
      return Promise.all(getAccountData(res));
    })
    .catch(function (error) {
      throw error;
    })
}

function userAdresses(usernames) {
  return usernames.map(val => {
    return fetch(
      addressUrl.replace(':user', val),
      {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        },
      }).then(function (response) {
      return response.json();
    }).then(function (res) {
      let user = {
        name: val,
        address: res
      };
      return user
    }).catch(function (error) {
      throw error;
    })
  });
}

function getAccountData(users) {
  var rtn = users.map(function (user) {
    return user.address.map(val => {
      return fetch(
        accountDataUrl.replace(":address", val),
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
          user.accountData = res[0];
          return user;
        })
        .catch(function (error) {
          throw error;
        });
    });
  });
  return rtn.reduce(function (a, b) {
    return a.concat(b);
  }, []);
}

function* fetchAccounts(action) {
  try {
    let response = yield call(getAccounts);
    yield put(fetchAccountsSuccess(response));
  }
  catch (err) {
    yield put(fetchAccountsFailure(err));
  }
}

export default function* watchFetchAccounts() {
  yield takeEvery(FETCH_ACCOUNTS, fetchAccounts);
}
