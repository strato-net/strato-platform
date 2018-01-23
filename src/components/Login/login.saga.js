import {
  takeLatest,
  put,
  call
} from 'redux-saga/effects';
import {
  VALIDATE_USER_REQUEST,
  validateUserSuccess,
  validateUserFailure
} from './login.action';

import { env } from '../../../../env';

const url = env.BLOC_URL + "/users/:user/:address/send?resolve"

export function validateUserAPICall(from, fromAddress, toAddress, value, password) {
  return fetch(
    url.replace(":user", from).replace(":address", fromAddress),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ value, password, toAddress })
    }
  )
    .then(function (response) {
      return response.json();
    })
    .catch(function (error) {
      throw error;
    });
}

export function* validateUser(action) {
  try {
    let response = yield call(
      validateUserAPICall,
      action.username,
      action.fromAddress,
      action.toAddress,
      action.value,
      action.password
    );
    yield put(validateUserSuccess(response));
  }
  catch (err) {
    yield put(validateUserFailure(err));
  }
}

export default function* watchValidateUser() {
  yield takeLatest(VALIDATE_USER_REQUEST, validateUser);
}
