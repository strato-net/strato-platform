import {
  takeEvery,
  put,
  call
} from 'redux-saga/effects';
import {
  getOrCreateOauthUserSuccess,
  getOrCreateOauthUserFailure,
  GET_OR_CREATE_OAUTH_USER_REQUEST,
} from './user.actions';
import { env } from '../../env';

const oauthUserUrl = env.APEX_URL + "/user";

function getOrCreateOauthUserApi() {
  return fetch(
    oauthUserUrl,
    {
      method: 'POST',
      credentials: "include",
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    })
    .then(function (response) {
      return response.json()
    })
    .catch(function (error) {
      throw error;
    });
}

function* getOrCreateOauthUser() {
  try {
    const user = yield call(getOrCreateOauthUserApi);
    if (user.error) {
      // We only get the non-401 errors here (401 is handled inside of getOrCreateOauthUserApi)
      console.error('Failed to create account for OAuth user. Error:', user.error)
      // Admin: refer to strato nginx and apex logs for details
    } else {
      localStorage.setItem('user', JSON.stringify(user));
      yield put(getOrCreateOauthUserSuccess(user));
    }
  } catch (e) {
    yield put(getOrCreateOauthUserFailure(e));
  }
}

export default function* watchFetchUser() {
  yield [
    takeEvery(GET_OR_CREATE_OAUTH_USER_REQUEST, getOrCreateOauthUser)
  ];
}
