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
} from './user.actions';
import { openVerifyAccountModal } from '../VerifyAccount/verifyAccount.actions';
import { env } from '../../env';

const loginUrl = env.APEX_URL + "/login";
const logoutUrl = env.APEX_URL + "/logout";

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
    .then(function (response) {
      return response.json();
    })
    .catch(function (error) {
      throw error;
    })
}

function firstTimeLoginRequest(email) {
  // TODO: call first time login API && check that the BlocH user isn't created already.
  return new Promise(function (resolve) {
    resolve({ exists: true })
  });
}

function* firstTimeLogin(action) {
  try {
    const response = yield call(firstTimeLoginRequest, action.email);
    if (response.exists) {
      yield put(firstTimeLoginSuccess(action.email));
      yield put(openVerifyAccountModal());
    } else {
      yield put(firstTimeLoginFailure(action.email, 'The user does not exist'));
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
    yield put(logoutSuccess());
  } catch (err) {
    // Handle when you have error on logout
  }
}

export default function* watchFetchUser() {
  yield [
    takeEvery(LOGIN_REQUEST, login),
    takeEvery(LOGOUT_REQUEST, logout),
    takeEvery(FIRST_TIME_LOGIN_REQUEST, firstTimeLogin)
  ];
}
