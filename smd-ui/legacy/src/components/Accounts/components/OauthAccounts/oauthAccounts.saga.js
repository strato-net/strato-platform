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
} from './oauthAccounts.actions';
import { createUrl } from '../../../../lib/url';

const accountDataUrl = env.STRATO_URL + "/account";

export function getOauthAccountDetailApi(address, chainid) {
  const options = { query: { address, chainid } };
  const url = createUrl(accountDataUrl, options);

  return fetch(
    url,
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
    if (response['0']) {
      yield put(fetchOauthAccountDetailSuccess(response['0']));
    } else {
      const account = {
        address: action.address,
        balance: '0',
        latestBlockNum: 0,
        nonce: 0
      }
      yield put(fetchOauthAccountDetailSuccess(account));
    }
  }
  catch (err) {
    yield put(fetchOauthAccountDetailFailure(err));
  }
}

export default function* watchOauthAccountActions() {
  yield [
    takeEvery(FETCH_OAUTH_ACCOUNT_DETAIL_REQUEST, getOauthAccountDetail),
  ];
}
