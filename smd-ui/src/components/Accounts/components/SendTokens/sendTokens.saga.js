import {
  takeLatest,
  put,
  call
} from 'redux-saga/effects';
import {
  SEND_TOKENS_REQUEST,
  sendTokensSuccess,
  sendTokensFailure
} from './sendTokens.actions';

import { env } from '../../../../env';
import { handleErrors } from '../../../../lib/handleErrors';

const url = env.BLOC_URL + "/users/:user/:address/send?resolve&:chainid"

export function sendTokensAPICall(from, fromAddress, toAddress, value, password, chainId) {
  const sendUrl = url.replace(":user", from).replace(":address", fromAddress);
  return fetch(
    chainId ? sendUrl.replace(":chainid", `chainid=${chainId}`) : sendUrl.replace("&:chainid", ''),
    {
      method: 'POST',
      credentials: "include",
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ value, password, toAddress })
    }
  )
    .then(handleErrors)
    .then(function (response) {
      return response.json();
    })
    .catch(function (error) {
      throw error;
    });
}

export function* sendTokens(action) {
  try {
    let response = yield call(
      sendTokensAPICall,
      action.from,
      action.fromAddress,
      action.toAddress,
      action.value,
      action.password,
      action.chainId
    );
    yield put(sendTokensSuccess(response));
  }
  catch (err) {
    yield put(sendTokensFailure(err.message));
  }
}

export default function* watchsendTokens() {
  yield takeLatest(SEND_TOKENS_REQUEST, sendTokens);
}
