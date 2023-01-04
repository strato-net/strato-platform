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
  fetchUserPubKeyFailure
} from './user.actions';
import { handleErrors } from '../../lib/handleErrors'; 
import { env } from '../../env';

const oauthUserUrl = env.APEX_URL + "/user";

function getOrCreateOauthUserApi() {
  const cirrusUrl = env.CIRRUS_URL + "/Certificate?userAddress=eq.";
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
    .then(r => { return r.json() })
    .then(function (res) {
      return res.json();
    })
    .then(function (user) {
      const url = cirrusUrl + user.address;
      return fetch(
        url,
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
    })
    .catch(function (error) {
      throw error;
    });
}

function fetchUserPubKeyRequest() {
  const pubkeyURL = `${env.STRATO_URL_V23}/key?username=nodekey`
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
    const user_query = yield call(getOrCreateOauthUserApi);
    if (user_query.error) {
      // We only get the non-401 errors here (401 is handled inside of getOrCreateOauthUserApi)
      console.error('Failed to create account for OAuth user. Error:', user_query.error)
      // Admin: refer to strato nginx and apex logs for details
    } else {
      const user = {
        username: user_query[0].commonName,
        commonName: user_query[0].commonName,
        organization: user_query[0].organization,
        organizationalUnit: user_query[0].organizationalUnit,
        country: user_query[0].country,
        address: user_query[0].userAddress,
      }

      localStorage.setItem('user', JSON.stringify(user));
      yield put(getOrCreateOauthUserSuccess(user));
    }
  } catch (e) {
    yield put(getOrCreateOauthUserFailure(e));
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
