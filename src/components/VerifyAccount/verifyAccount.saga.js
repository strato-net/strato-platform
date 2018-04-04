import {
  takeEvery,
  put,
  call
} from 'redux-saga/effects';
import {
  VERIFY_TEMPORARY_PASSWORD_REQUEST,
  verifyTempPasswordSuccess,
  verifyTempPasswordFailure,
  closeVerifyAccountModal
} from './verifyAccount.actions';
import { openCreatePasswordModal } from '../CreatePassword/createPassword.actions';
import { env } from '../../env';

const verify = env.APEX_URL + '/verify-temporary-password';

function verifyTempPasswordRequest(tempPassword, email) {
  return fetch(verify, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ tempPassword: tempPassword, email })
  }).then(function (response) {
    return response.json();
  }).catch(function (error) {
    throw error;
  });
}

function* verifyTempPassword(action) {
  try {
    const response = yield call(verifyTempPasswordRequest, action.tempPassword, action.email);

    if (response.success) {
      yield put(verifyTempPasswordSuccess(response.success));
      yield put(closeVerifyAccountModal());
      yield put(openCreatePasswordModal());
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
