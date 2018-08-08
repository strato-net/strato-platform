import {
  takeEvery,
  put,
  call
} from 'redux-saga/effects';
import {
  SIGN_REQUEST,
  signPayloadSuccess,
  signPayloadFailure
} from './signature.action';
import { env } from '../../env';

const signUrl = "http://localhost/strato/v2.3/signature/strato/v2.3/signature";

function signDataRequest(payload) {
  return fetch(
    signUrl,
    {
      method: 'POST',
      credentials: "include",
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ queryToSign: payload.value })
    })
    .then(function (response) {
      return response.json()
    })
    .catch(function (error) {
      throw error;
    });
}

function* signData(action) {
  try {
    const responseData = yield call(signDataRequest, action.payload);
    
    if (responseData.error) {
      yield put(signPayloadFailure(responseData.error.message))
    } else {
      yield put(signPayloadSuccess(responseData));
    }
  } catch (err) {
    // Handle when you have error on logout
    yield put(signPayloadFailure(err.message))
  }
}

export default function* watchSignData() {
  yield [
    takeEvery(SIGN_REQUEST, signData),
  ];
}
