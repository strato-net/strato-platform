import {
  takeEvery,
  put,
  call
} from 'redux-saga/effects';
import {
  LOGIN_REQUEST,
  LOGOUT_REQUEST,
  loginSuccess,
  loginFailure,
  logoutSuccess
} from './user.actions';
import { setCookie } from '../../lib/parsejwt';
import { token } from '../../mock_api/token';
const user = require('../../mock_api/user.json'); // Remove this when actual API is implemented

function loginRequest(email, password) {
  return user;
  // return fetch(
  //   verifyUserUrl,
  //   {
  //     method: 'POST',
  //     headers: {
  //       'Accept': 'application/json'
  //     },
  //     body: JSON.stringify({email, password})
  //   }
  //   .then(function (response) {
  //     return response.json();
  //   })
  //   .catch( function (error) {
  //     throw error;
  //   })
  // )
}

function logoutAccount() {
  return true;
  // return fetch(
  //   logoutUrl,
  //   {
  //     method: 'POST',
  //     headers: {
  //       'Accept': 'application/json'
  //     }
  //   }
  //   .then(function (response) {
  //     response.json();
  //   })
  //   .catch( function (error) {
  //     throw error;
  //   })
  // )
}

function* login(action) {
  try {
    const response = yield call(loginRequest, action.email, action.password);
    yield put(loginSuccess(action.email, response));
    /*Please remove when acutal API is integrated*/
    setCookie('token', token, 1);
    /* ----------------- */

  } catch(err) {
    yield put(loginFailure(action.email, err));
  }
}

function* logout() {
  try {
    yield call(logoutAccount);
    yield put(logoutSuccess());
    /*Please remove when acutal API is integrated*/
    setCookie('token');
    /* ----------------- */
  } catch(err) {
    // Handle when you have error on logout
  }
}

export default function* watchFetchUser() {
  yield [
    takeEvery(LOGIN_REQUEST, login),
    takeEvery(LOGOUT_REQUEST, logout)
  ];
}
