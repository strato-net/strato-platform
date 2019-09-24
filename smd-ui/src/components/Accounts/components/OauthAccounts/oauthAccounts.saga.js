import {
  takeEvery,
  put,
  call,
} from 'redux-saga/effects';
import { env } from '../../../../env';
import { handleErrors } from '../../../../lib/handleErrors';
import {
  fetchOauthAccountDetailSuccess,
  fetchOauthAccountDetailFailure,
  FETCH_OAUTH_ACCOUNT_DETAIL_REQUEST,
  fetchOauthAccountDetail,
  oauthFaucetSuccess,
  oauthFaucetFailure,
  OAUTH_FAUCET_REQUEST
} from './oauthAccounts.actions';
import { delay } from 'redux-saga';

const accountDataUrl = env.STRATO_URL + "/account?address=:address&:chainid";
const faucetUrl = env.BLOC_URL + "/users/:user/:address/fill?resolve"

export function postFaucet(username, address) {
  return fetch(
    faucetUrl.replace(":user", username)
      .replace(":address", address),
    {
      method: 'POST',
      credentials: "include",
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }
  )
    .then(handleErrors)
    .then(function (response) {
      return;
    })
    .catch(function (error) {
      throw error;
    })
}

export function getOauthAccountDetailApi(address, chainId) {
  const localAccountDataUrl = chainId ? accountDataUrl.replace(":address", address).replace(":chainid", `chainid=${chainId}`) : accountDataUrl.replace(":address", address).replace("&:chainid", '')
  return fetch(
    localAccountDataUrl,
    {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Accept': 'application/json'
      },
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

export function* getOauthAccountDetail(action) {
  try {
    const response = yield call(getOauthAccountDetailApi, action.address, action.chainId);
    // don't ask about response['0'].
    yield put(fetchOauthAccountDetailSuccess(response['0']));
  }
  catch (err) {
    yield put(fetchOauthAccountDetailFailure(err));
  }
}


export function* faucetAccount(action) {
  try {
    yield call(postFaucet, action.name, action.address);
    yield call(delay, 100)
    yield put(fetchOauthAccountDetail(action.name, action.address, action.chainId));
    yield put(oauthFaucetSuccess());
  }
  catch (err) {
    yield put(oauthFaucetFailure(err))
  }
}

export default function* watchOauthAccountActions() {
  yield [
    takeEvery(FETCH_OAUTH_ACCOUNT_DETAIL_REQUEST, getOauthAccountDetail),
    takeEvery(OAUTH_FAUCET_REQUEST, faucetAccount),
  ];
}
