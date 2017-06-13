import {
  takeLatest,
  put,
  call
} from 'redux-saga/effects';
import {
  CREATE_USER,
  createUserSuccess,
  createUserFailure,
} from './createUser.actions';

import {
  fetchAccounts
} from '../Accounts/accounts.actions';

import { NODES } from '../../env';

const url = NODES[0].url + "/bloc/v2.1/users/:user?faucet"

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
  yield takeLatest(CREATE_USER, createUser);
}
