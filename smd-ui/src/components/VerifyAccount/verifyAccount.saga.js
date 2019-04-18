import {
  takeEvery,
  put,
  call
} from 'redux-saga/effects';
import {
  VERIFY_TEMPORARY_PASSWORD_REQUEST,
  verifyTempPasswordSuccess,
  verifyTempPasswordFailure
} from './verifyAccount.actions';
import { env } from '../../env';
import { handleErrors } from '../../lib/handleErrors';

const verify = env.APEX_URL + '/verify-temporary-password';

export function verifyTempPasswordRequest(tempPassword, email) {
  return fetch(verify, {
    method: 'POST',
    credentials: "include",
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ tempPassword: tempPassword, email })
  })
  .then(handleErrors)
  .then(function (response) {
    return response.json();
  }).catch(function (error) {
    throw error;
  });
}

export function* verifyTempPassword(action) {
  try {
    const response = yield call(verifyTempPasswordRequest, action.tempPassword, action.email);

    if (response.success) {
      yield put(verifyTempPasswordSuccess(response.success));
    } else {
      yield put(verifyTempPasswordFailure(response.error.message));
    }
  } catch (err) {
    yield put(verifyTempPasswordFailure(err));
  }
}

export default function* watchVerifyAccount() {
  yield [
    takeEvery(VERIFY_TEMPORARY_PASSWORD_REQUEST, verifyTempPassword)
  ];
}
