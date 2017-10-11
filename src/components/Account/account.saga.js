import {
  takeEvery,
  put,
  call
} from 'redux-saga/effects';
import {
  VERIFY_ACCOUNT,
  LOGOUT_ACCOUNT,
  handleAccountSuccess,
  handleAccountFailure,
  logoutSuccess
} from './account.actions';
import { env } from '../../env';

//Use this to verify account details
const verifyAccountUrl = '';
const logoutUrl = '';

function getAccount(email, password) {
  return fetch(
    verifyAccountUrl,
    {
      method: 'POST',
      headers: {
        'Accept': 'application/json'
      },
      body: JSON.stringify({email, password})
    }
    .then(function (response) {
      return response.json();
    })
    .catch( function (error) {
      throw error;
    })
  )
}

function logoutAccount() {
  return fetch(
    logout,
    {
      method: 'POST',
      headers: {
        'Accept': 'application/json'
      }
    }
    .then(function (response) {
      response.json();
    })
    .catch( function (error) {
      throw error;
    })
  )
}

function* verifyAccount(action) {
  try {
    const response = yield call(getAccount, action.email, action.password);
    yield put(handleAccountSuccess(action.email, response));
  } catch(err) {
    yield put(handleAccountFailure(action.email, err));
  }
}

function* logout() {
  try {
    const response = yield call(logoutAccount);
    yield put(logoutSuccess());
  } catch(err) {
    // Handle when you have error on logout
  }
}

export default function* watchFetchAccount() {
  yield [
    takeEvery(VERIFY_ACCOUNT, verifyAccount),
    takeEvery(LOGOUT_ACCOUNT, logout)
  ];
}
