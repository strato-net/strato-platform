import {
  takeEvery,
  put,
  call
} from 'redux-saga/effects';
import {
  VERIFY_USER,
  LOGOUT_USER,
  handleUserSuccess,
  handleUserFailure,
  logoutSuccess
} from './user.actions';
import { setCookie } from '../../lib/parsejwt';
import { token } from '../../mock_api/token';
const user = require('../../mock_api/user.json'); // Remove this when actual API is implemented

function getUser(email, password) {
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

function* verifyUser(action) {
  try {
    const response = yield call(getUser, action.email, action.password);
    yield put(handleUserSuccess(action.email, response));
    /*Please remove when acutal API is integrated*/
    setCookie('token', token, 1);
    /* ----------------- */

  } catch(err) {
    yield put(handleUserFailure(action.email, err));
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
    takeEvery(VERIFY_USER, verifyUser),
    takeEvery(LOGOUT_USER, logout)
  ];
}
