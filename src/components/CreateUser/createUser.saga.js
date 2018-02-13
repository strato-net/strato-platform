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
import { setCookie } from '../../lib/parsejwt';
import { token } from '../../mock_api/token';
import { loginSuccess } from '../User/user.actions';
import { openWalkThroughOverlay } from '../WalkThrough/walkThrough.actions';
const user = require('../../mock_api/user.json');

const url = env.BLOC_URL + "/users/:user"

export function createUserApiCall(username, password) {
  return fetch(
    url.replace(":user", username),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'password=' + password
    }
  )
    .then(function (response) {
      return response;
    })
    .catch(function (error) {
      throw error;
    });
}

export function* createUser(action) {
  try {
    let response = yield call(createUserApiCall, action.username, action.password);
    yield put(createUserSuccess(response));
    // yield put(fetchAccounts(false, false));
    setCookie('token', token, 1);
    yield put(loginSuccess(action.username, user));
    yield put(openWalkThroughOverlay());
  }
  catch (err) {
    yield put(createUserFailure(err));
  }
}

export default function* watchCreateUser() {
  yield takeLatest(CREATE_USER_REQUEST, createUser);
}
