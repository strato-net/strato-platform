import {
  takeEvery,
  put,
  call
} from 'redux-saga/effects';
import {
  getOrCreateOauthUserSuccess,
  getOrCreateOauthUserFailure,
  GET_OR_CREATE_OAUTH_USER_REQUEST,
  LOGOUT_REQUEST,
  logoutSuccess,
} from './user.actions';
import { env } from '../../env';
import { handleErrors } from '../../lib/handleErrors';

const oauthUserUrl = env.APEX_URL + "/user";
const logoutUrl = env.APEX_URL + "/logout";

function logoutAccount() {
  return fetch(
    logoutUrl,
    {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    })
    .then(handleErrors)
    .then(function (response) {
      return response.json();
    })
    .catch(function (error) {
      throw error;
    })
}

function getOrCreateOauthUserApi() {
  return fetch(
    oauthUserUrl,
    {
      method: 'POST',
      credentials: "include",
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    })
    .then(function (response) {
      return response.json()
    })
    .catch(function (error) {
      throw error;
    });
}

function* logout() {
  try {
    yield call(logoutAccount);
    localStorage.removeItem('token');
    yield put(logoutSuccess());
  } catch (err) {
    // Handle when you have error on logout
  }
}

function* getOrCreateOauthUser() {
  try {
    const user = yield call(getOrCreateOauthUserApi);
    if (user.error) {
      window.location.href = '/auth/logout'
    } else {
      localStorage.setItem('user', JSON.stringify(user));
      yield put(getOrCreateOauthUserSuccess(user));
    }
  } catch (e) {
    yield put(getOrCreateOauthUserFailure(e));
  }
}

export default function* watchFetchUser() {
  yield [
    takeEvery(LOGOUT_REQUEST, logout),
    takeEvery(GET_OR_CREATE_OAUTH_USER_REQUEST, getOrCreateOauthUser)
  ];
}
