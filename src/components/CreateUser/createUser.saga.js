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

import {
  fetchAccounts
} from '../Accounts/accounts.actions';

import { env } from '../../env';

const url = env.BLOC_URL + "/users/:user?faucet"

function createUserApiCall(username, password) {
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
  .then(function(response) {
    return response;
  })
  .catch(function(error) {
    throw error;
  });
}

function* createUser(action) {
  try {
    let response = yield call(createUserApiCall, action.username, action.password);
    yield put(createUserSuccess(response));
    yield put(fetchAccounts());
  }
  catch (err) {
    yield put(createUserFailure(err));
  }
}

export default function* watchCreateUser() {
  yield takeLatest(CREATE_USER_REQUEST, createUser);
}
