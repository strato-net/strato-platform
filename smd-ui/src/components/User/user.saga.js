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
  FETCH_USER_CERT_REQUEST,
  fetchUserPubKeySuccess,
  fetchUserPubKeyFailure,
  getUserCertificateSuccess,
  getUserCertificateFailure,
} from './user.actions';
import { handleErrors } from '../../lib/handleErrors'; 
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
    .then(handleErrors)
    .then(function (res) {
      return res.json();
    })
    .catch(function (error) {
      throw error;
    });
    
}

function fetchUserCertificateApi(address) {
  const cirrusUrl = env.CIRRUS_URL + "/Certificate?userAddress=eq." + address;
  return fetch(
    cirrusUrl,
    {
      method: 'GET',
      credentials: "include",
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
  })
}

function fetchUserPubKeyRequest() {
  const pubkeyURL = `${env.STRATO_URL_V23}/key`
  return fetch(
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
export function* getUserCertificate(action) {
  try {
    const userCert = yield call(fetchUserCertificateApi, action.userAddress);
    const user = userCert[0]

    if (userCert.length === 0) {
      yield put(getUserCertificateFailure(new Error("No User Certificate found")));
      
    }
    yield put(getUserCertificateSuccess(user));
  } catch (e) {
    yield put(getUserCertificateFailure(e));
  }
}

export function* getUserPubKey() {
  try {
    const response = yield call(fetchUserPubKeyRequest);
    yield put(fetchUserPubKeySuccess(response.pubkey));
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
export function* watchuserCert() {
  yield takeEvery(FETCH_USER_CERT_REQUEST, getUserCertificate);
}
