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

const blocSendUrl = env.BLOC_URL + "/users/:user/:address/send?resolve&:chainid"
const transactionUrl = env.STRATO_URL_V23 + "/transaction?resolve=true&:chainid"

export function sendTokensAPICall(from, fromAddress, toAddress, value, password, chainId) {
  const sendUrl = blocSendUrl.replace(":user", from).replace(":address", fromAddress);
  const blocUrl = chainId ? sendUrl.replace(":chainid", `chainid=${chainId}`) : sendUrl.replace("&:chainid", '');
  const oauthUrl = chainId ? transactionUrl.replace(":chainid", `chainid=${chainId}`) : transactionUrl.replace("&:chainid", '');
  const url = env.OAUTH_ENABLED ? oauthUrl : blocUrl;

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

  const body = env.OAUTH_ENABLED ? oauthBody : blocBody;

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
    const data = env.OAUTH_ENABLED ? response[0] : response;
    yield put(sendTokensSuccess(data));
  }
  catch (err) {
    yield put(sendTokensFailure(err.message));
  }
}

export default function* watchsendTokens() {
  yield takeLatest(SEND_TOKENS_REQUEST, sendTokens);
}
