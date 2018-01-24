import {
  takeEvery,
  put,
  call
} from 'redux-saga/effects';
import {
  fetchAppsSuccess,
  fetchAppsFailure,
  FETCH_APPS
} from './apps.actions';
import { env } from '../../env';

const applicationsUrl = env.CIRRUS_URL + '/AppMetadata';

const applicationData = [{
  "address": "897559d78c5ecc9a7e3f16fc55151b5f4f33acef",
  "hash": "1e743d5cf460f28be290a8a5d8212bf9",
  "maintainer": "BlockApps Inc",
  "appName": "lottery-demo-app",
  "owner": "083c94fdb36c50a044363845a6640da1abfb6cd2",
  "version": "0.1.0",
  "host": "stratodev.blockapps.net",
  "description": "This apps demonstrates how to create a DApp using the STRATO platform"
}];

export function getApps() {
  return fetch(
    applicationsUrl,
    {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      },
    })
    .then(function (response) {
      return response.json();
    })
    .catch(function (error) {
      throw error;
    });
}

export function* fetchApps(action) {
  try {
    yield call(getApps);
    yield put(fetchAppsSuccess(applicationData));
  }
  catch (err) {
    yield put(fetchAppsFailure(err));
  }
}

export default function* watchFetchApps() {
  yield takeEvery(FETCH_APPS, fetchApps);
}
