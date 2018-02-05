import {
  takeLatest,
  put,
  call
} from 'redux-saga/effects';
import {
  SEND_ETHER_REQUEST,
  sendEtherSuccess,
  sendEtherFailure
} from './sendEther.actions';

import { env } from '../../../../env';

const url = env.BLOC_URL + "/users/:user/:address/send?resolve"

export function sendEtherAPICall(from, fromAddress, toAddress, value, password) {
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

export function* sendEther(action) {
  try {
    let response = yield call(
      sendEtherAPICall,
      action.from,
      action.fromAddress,
      action.toAddress,
      action.value,
      action.password
    );
    yield put(sendEtherSuccess(response));
  }
  catch (err) {
    yield put(sendEtherFailure(err));
  }
}

export default function* watchSendEther() {
  yield takeLatest(SEND_ETHER_REQUEST, sendEther);
}
