import {
  takeEvery,
  put,
  call
} from 'redux-saga/effects';
import {
  getOrCreateOauthUserSuccess,
  getOrCreateOauthUserFailure,
  GET_OR_CREATE_OAUTH_USER_REQUEST,
  FETCH_USER_PUBLIC_KEY_REQUEST,
  fetchUserPubKeySuccess,
  fetchUserPubKeyFailure,
} from './user.actions';
import { handleErrors } from '../../lib/handleErrors'; 
import { env } from '../../env';
import { secureFetch } from '../../lib/csrf';

const oauthUserUrl = env.APEX_URL + "/user";

function getOrCreateOauthUserApi() {

  return secureFetch(
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
    .then(handleErrors)
    .then(function (res) {
      return res.json();
    })
    .catch(function (error) {
      throw error;
    });
    
}

function fetchUserPubKeyRequest() {
  const pubkeyURL = `${env.STRATO_URL_V23}/key`
  return secureFetch(
    pubkeyURL,
    {
      method: 'GET',
      credentials: "include",
      headers: {
        'Accept': 'application/json'
      }
    }
  )
  .then(handleErrors)
  .then(res => res.json()
  .catch(e => {throw e}))
}

export function* getOrCreateOauthUser() {
  try {
    const oauthUser = yield call(getOrCreateOauthUserApi);
    if (oauthUser.error) {
      // We only get the non-401 errors here (401 is handled inside of getOrCreateOauthUserApi)
      console.error('Failed to create account for OAuth user. Error:', oauthUser.error)
      // Admin: refer to strato nginx and apex logs for details
    } else {

      const user = oauthUser

      yield put(getOrCreateOauthUserSuccess(user));
    }
  } catch (e) {
    yield put(getOrCreateOauthUserFailure(e));
  }
}
export function* getUserPubKey() {
  try {
    const response = yield call(fetchUserPubKeyRequest);
    yield put(fetchUserPubKeySuccess(response.pubkey, response.address));
  }
  catch (err) {
    yield put(fetchUserPubKeyFailure(err));
  }
}

export function* watchFetchUser() {
  yield takeEvery(GET_OR_CREATE_OAUTH_USER_REQUEST, getOrCreateOauthUser);
}

export function* watchFetchPubKey() {
  yield takeEvery(FETCH_USER_PUBLIC_KEY_REQUEST, getUserPubKey);
}