import {
  takeEvery,
  put,
  call
} from 'redux-saga/effects';
import {
  VERIFY_OTP_REQUEST,
  verifyOTPSuccess,
  verifyOTPFailure
} from './verifyAccount.actions';

function verifyOTPRequest(OTP) {
  // TODO will append API later on
  return new Promise(function (resolve) {
    resolve({ success: true })
  });
}

function* verifyOTP(action) {
  try {
    const response = yield call(verifyOTPRequest, action.OTP);
    if(response.success) {
      yield put(verifyOTPSuccess());
    } else {
      yield put(verifyOTPFailure('OTP is incorrect'));
    }
  } catch (err) {
    yield put(verifyOTPFailure(err));
  }
}

export default function* watchVerifyAccount() {
  yield [
    takeEvery(VERIFY_OTP_REQUEST, verifyOTP)
  ];
}
