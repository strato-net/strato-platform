import {
  takeLatest,
  put,
  call
} from 'redux-saga/effects';
import {
  FETCH_ACCOUNT_DETAIL_REQUEST,
  fetchAccountDetailSuccess,
  fetchAccountDetailFailure,
} from './profile.action';
import { env } from '../../env';

const accountDataUrl = env.STRATO_URL + "/account?address=:address";

export function getAccountDetailApi(address) {
  return fetch(
    accountDataUrl.replace(":address", address),
    {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      },
    }
  )
    .then(function (response) {
      return response.json();
    })
    .catch(function (error) {
      throw error;
    });
}

export function* getAccountDetail(action) {
  try {
    const response = yield call(getAccountDetailApi, action.address);
    if(response.length === 0) {
      // account is invalid. logout user.
      localStorage.removeItem(env.USERKEY);
      return;
    }
    yield put(fetchAccountDetailSuccess(action.name, action.address, response['0']));
  }
  catch (err) {
    yield put(fetchAccountDetailFailure(action.name, action.address, err));
  }
}

export default function* watchAccountActions() {
  yield [
    takeLatest(FETCH_ACCOUNT_DETAIL_REQUEST, getAccountDetail)
  ];
}