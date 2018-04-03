import {
  takeLatest,
  put,
  call
} from 'redux-saga/effects';
import {
  CREATE_USER_REQUEST,
  createUserSuccess,
  createUserFailure,
} from './createUser.actions';

// import {
//   fetchAccounts
// } from '../Accounts/accounts.actions';

import { env } from '../../env';
import { loginSuccess } from '../User/user.actions';
import { openWalkThroughOverlay } from '../WalkThrough/walkThrough.actions';
import { closeCreatePasswordModal } from '../CreatePassword/createPassword.actions';

const url = env.APEX_URL + "/users";

export function createUserApiCall(username, password) {
  return fetch(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: "username=" + username + "&password=" + password,
      credentials: 'include'
    }
  )
    .then(function (response) {
      return response.json();
    })
    .catch(function (error) {
      throw error;
    });
}

export function* createUser(action) {
  try {
    let response = yield call(createUserApiCall, action.username, action.password);
    if (response.error) {
      yield put(createUserFailure(response.error.message));
    } else {
      yield put(createUserSuccess(response.user));
      // yield put(fetchAccounts(false, false));
      localStorage.setItem('token', JSON.stringify(response.user));
      yield put(loginSuccess(action.username, response.user));
      yield put(closeCreatePasswordModal());
      yield put(openWalkThroughOverlay(true));
    }
  }
  catch (err) {
    yield put(createUserFailure(err));
  }
}

export default function* watchCreateUser() {
  yield takeLatest(CREATE_USER_REQUEST, createUser);
}
