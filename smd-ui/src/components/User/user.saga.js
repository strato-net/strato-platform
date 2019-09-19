import {
  takeEvery,
  put,
  call
} from 'redux-saga/effects';
import {
  LOGIN_REQUEST,
  LOGOUT_REQUEST,
  FIRST_TIME_LOGIN_REQUEST,
  loginSuccess,
  loginFailure,
  logoutSuccess,
  firstTimeLoginSuccess,
  firstTimeLoginFailure,
  resetFirstTimeUser,
  GET_KEY_REQUEST,
  getKeySuccess,
  getKeyFailure,
  CREATE_OAUTH_USER_REQUEST,
  createOauthUserRequest,
  createOauthUserSuccess,
  createOauthUserFailure,
} from './user.actions';
import { env } from '../../env';
import { resetTemporarypassword } from '../VerifyAccount/verifyAccount.actions';
import { handleErrors } from '../../lib/handleErrors';

const oauthUserUrl = env.APEX_URL + "/user";
const keyUrl = env.STRATO_URL_V23 + "/key";
const loginUrl = env.APEX_URL + "/login";
const logoutUrl = env.APEX_URL + "/logout";
const verifyEmailUrl = env.APEX_URL + "/verify-email";

function loginRequest(username, password) {
  return fetch(
    loginUrl,
    {
      method: 'POST',
      credentials: "include",
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ username, password })
    })
    .then(handleErrors)
    .then(function (response) {
      return response.json()
    })
    .catch(function (error) {
      throw error;
    });
}

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

function firstTimeLoginRequest(email) {
  return fetch(
    verifyEmailUrl,
    {
      method: 'POST',
      credentials: "include",
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email })
    })
    .then(function (response) {
      return response.json()
    })
    .catch(function (error) {
      throw error;
    });
}

function getKeyApi() {
  return fetch(
    keyUrl,
    {
      method: 'GET',
      credentials: "include",
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    })
    .then(function (response) {
      return response.json()
    })
    .catch(function (error) {
      throw error;
    });
}

function createOauthUserApi() {
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

function* firstTimeLogin(action) {
  try {
    const response = yield call(firstTimeLoginRequest, action.email);
    if (response.exists) {
      yield put(firstTimeLoginSuccess(action.email));
    } else {
      yield put(firstTimeLoginFailure(action.email, response.error.message));
    }
  } catch (err) {
    yield put(firstTimeLoginFailure(action.username, err));
  }
}

function* login(action) {
  try {
    const response = yield call(loginRequest, action.username, action.password);
    if (!response.error) {
      yield put(loginSuccess(action.username, response.user));
      localStorage.setItem('token', JSON.stringify(response.user));
    } else {
      yield put(loginFailure(action.username, response.error.message));
    }
  } catch (err) {
    yield put(loginFailure(action.username, err));
  }
}

function* logout() {
  try {
    yield call(logoutAccount);
    localStorage.removeItem('token');
    yield put(resetTemporarypassword());
    yield put(resetFirstTimeUser());
    yield put(logoutSuccess());
  } catch (err) {
    // Handle when you have error on logout
  }
}

function* getKey() {
  try {
    const response = yield call(getKeyApi);

    if (response.includes("doesn't exist")) {
      yield put(createOauthUserRequest());
      yield put(getKeyFailure(response));
    } else {
      yield put(getKeySuccess(response));
    }
  } catch (err) {
    yield put(getKeyFailure(err));
  }
}

function* createOauthUser() {
  try {
    const response = yield call(createOauthUserApi);
    yield put(createOauthUserSuccess(response));
  } catch (e) {
    yield put(createOauthUserFailure(e));
  }
}

export default function* watchFetchUser() {
  yield [
    takeEvery(LOGIN_REQUEST, login),
    takeEvery(LOGOUT_REQUEST, logout),
    takeEvery(FIRST_TIME_LOGIN_REQUEST, firstTimeLogin),
    takeEvery(GET_KEY_REQUEST, getKey),
    takeEvery(CREATE_OAUTH_USER_REQUEST, createOauthUser)
  ];
}
