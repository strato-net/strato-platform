import {
  takeLatest,
  put,
  call
} from 'redux-saga/effects';
import {
  CREATE_USER_REQUEST,
  createUserSuccess,
  createUserFailure,
} from './register.actions';

import { env } from '../../env';

const url = env.BLOC_URL + "/users/:user?faucet"

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
  .then(function(response) {
    return response.json();
  })
  .catch(function(error) {
    throw error;
  });
}

export function* createUser(action) {
  try {
    let response = yield call(createUserApiCall, action.username, action.password);
    yield put(createUserSuccess(response, action.username));
  }
  catch (err) {
    yield put(createUserFailure(err));
  }
}

export default function* watchCreateUser() {
  yield takeLatest(CREATE_USER_REQUEST, createUser);
}
