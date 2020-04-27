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
import { isOauthEnabled } from '../../../../lib/checkMode';
import { createUrl } from '../../../../lib/url';

const blocSendUrl = env.BLOC_URL + "/users/::user/::address/send";
const transactionUrl = env.STRATO_URL_V23 + "/transaction";

export function sendTokensAPICall(from, fromAddress, toAddress, value, password, chainid) {

  const options = isOauthEnabled() ? { query: { resolve: true, chainid } } : { params: { user: from, address: fromAddress }, query: { resolve: true, chainid } };
  const url = createUrl(isOauthEnabled() ? transactionUrl : blocSendUrl, options);

  const blocBody = { value, password, toAddress };
  const oauthBody = {
    "txs": [
      {
        "payload": {
          "toAddress": toAddress,
          "value": value,
          "metadata": {

          }
        },
        "type": "TRANSFER"
      }
    ]
  }

  const body = isOauthEnabled() ? oauthBody : blocBody;

  return fetch(
    url,
    {
      method: 'POST',
      credentials: "include",
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body)
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
    const data = isOauthEnabled() ? response[0] : response;
    yield put(sendTokensSuccess(data));
  }
  catch (err) {
    yield put(sendTokensFailure(err.message));
  }
}

export default function* watchsendTokens() {
  yield takeLatest(SEND_TOKENS_REQUEST, sendTokens);
}
