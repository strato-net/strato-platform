import {
  takeLatest,
  put,
  call
} from 'redux-saga/effects';
import {
  CREATE_BLOC_USER_REQUEST,
  createBlocUserSuccess,
  createBlocUserFailure,
} from './createBlocUser.actions';

import {
  fetchAccounts
} from '../Accounts/accounts.actions';

import { env } from '../../env';
import { handleErrors } from '../../lib/handleErrors';

const url = env.BLOC_URL + "/users/:user"

export function createBlocUserApiCall(username, password) {
  return fetch(
    url.replace(":user", username),
    {
      method: 'POST',
      credentials: "include",
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(password)
    }
  )
    .then(handleErrors)
    .then(function (response) {
      return response;
    })
    .catch(function (error) {
      throw error;
    });
}

export function* createBlocUser(action) {
  try {
    let response = yield call(createBlocUserApiCall, action.username, action.password);
    yield put(createBlocUserSuccess(response));
    yield put(fetchAccounts(false, false));
  }
  catch (err) {
    yield put(createBlocUserFailure(err));
  }
}

export default function* watchCreateBlocUser() {
  yield takeLatest(CREATE_BLOC_USER_REQUEST, createBlocUser);
}
