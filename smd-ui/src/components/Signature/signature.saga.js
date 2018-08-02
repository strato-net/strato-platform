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
      body: JSON.stringify({ hash: payload.value })
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
    console.log(action)
    const responseData = yield call(signDataRequest, action.payload);
    console.log('lets check response:::', responseData)
    yield put(signPayloadSuccess(responseData));
  } catch (err) {
    // Handle when you have error on logout
  }
}

export default function* watchSignData() {
  yield [
    takeEvery(SIGN_REQUEST, signData),
  ];
}
