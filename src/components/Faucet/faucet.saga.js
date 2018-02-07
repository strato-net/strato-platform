import {
  takeLatest,
  put,
  call
} from 'redux-saga/effects';
import {
  FAUCET_REQUEST,
  faucetSuccess,
  faucetFailure
} from './faucet.actions';

import {
  fetchAccounts
} from '../Accounts/accounts.actions';

import { env } from '../../env';

const url = env.BLOC_URL + "/users/:user"

export function faucetApiCall(username, password) {
  return fetch(
    url.replace(":user", username),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'password=' + password
    }
  )
  .then(function(response) {
    return response;
  })
  .catch(function(error) {
    throw error;
  });
}

export function* faucet(action) {
  try {
    let response = yield call(faucetApiCall, action.username, action.password);
    yield put(faucetSuccess(response));
    yield put(fetchAccounts(false, false));
  }
  catch (err) {
    yield put(faucetFailure(err));
  }
}

export default function* watchFaucet() {
  yield takeLatest(FAUCET_REQUEST, faucet);
}
