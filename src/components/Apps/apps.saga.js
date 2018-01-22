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
// import { env } from '../../env';

// const applicationsUrl = env.CIRRUS_URL + '/AppMetadata';
const applicationsUrl = 'http://localhost/cirrus/search/AppMetadata';

const applicationData = [{
  "address": "38a757f8a75453346dcb8149d52df09549f25562",
  "hash": "e80b681c42f831ea3c4b8db531f5e165",
  "maintainer": "BlockApps info@blockapps.net",
  "appName": "Simple_storage_DApp",
  "owner": "083c94fdb36c50a044363845a6640da1abfb6cd2",
  "version": "0.0.1", "host": "stratodev.blockapps.net",
  "description": "The simplest example of the STRATO decentralized application running on top of the simple storage contract with value setter and getter functions"
},
{
  "address": "897559d78c5ecc9a7e3f16fc55151b5f4f33acef",
  "hash": "1e743d5cf460f28be290a8a5d8212bf9",
  "maintainer": "BlockApps Inc",
  "appName": "lottery-demo-app",
  "owner": "083c94fdb36c50a044363845a6640da1abfb6cd2",
  "version": "0.1.0",
  "host": "stratodev.blockapps.net",
  "description": "This apps demonstrates how to create a DApp using the STRATO platform"
},
{
  "address": "082f2b34e213e0c5627e3ac342bbd2ce9e904bbc",
  "hash": "2598425af6cc43ea45098148e11452f0",
  "maintainer": "BlockApps Inc",
  "appName": "lottery-demo-app-meetup",
  "owner": "a63cf1216a7005ba01023fae058a45e7493c4fe0",
  "version": "0.1.1",
  "host": "stratodev.blockapps.net",
  "description": "This apps demonstrates how to create a DApp using the STRATO platform"
}]

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
      return response.json()
    })
    .catch(function (error) {
      throw error;
    });
}

export function* fetchApps(action) {
  try {
    let response = yield call(getApps);
    yield put(fetchAppsSuccess(applicationData));
  }
  catch (err) {
    yield put(fetchAppsFailure(err));
  }
}

export default function* watchFetchApps() {
  yield takeEvery(FETCH_APPS, fetchApps);
}
