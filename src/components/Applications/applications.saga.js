import {
  takeEvery,
  put,
  call
} from 'redux-saga/effects';
import {
  FETCH_APPLICATIONS,
  LAUNCH_APP,
  fetchApplicationsSuccess,
  fetchApplicationsFailure,
  launchAppSuccess,
  launchAppFailure
} from './applications.actions';
import { env } from '../../env';

const applicationsUrl = env.CIRRUS_URL + '/AppMetadata';
const launchAppUrl = 'http://localhost:3001/apps/:hash';

function getApplications() {
  return fetch(
    applicationsUrl,
    {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
    },
  })
  .then(function(response) {
    return response.json()
  })
  .catch(function(error) {
    throw error;
  });
}

function launchApp(hash) {
  return fetch(
    launchAppUrl.replace(':hash', hash),
    {
      method: 'GET',
      headers: {
        'Accept': 'application/json'  
      }
    })
    .then(function(response) {
      // console.log("response", response);
      return response.json()
    })
    .catch(function(error) {
      throw error;
    });
}

function* fetchApplications(action) {
  try {
    let response = yield call(getApplications);
    yield put(fetchApplicationsSuccess(response));
  }
  catch (err) {
    yield put(fetchApplicationsFailure(err));
  }
}

function* launchApps(action) {
  try {
    let tempHash = '9ee1efe781ed3e4036d7110c2bf3dbb89f307307';
    let response = yield call(launchApp(tempHash));
    yield put (launchAppSuccess(response, launchAppUrl.replace(':hash', tempHash)));
  }
  catch (err) {
    yield put (launchAppFailure());
  }
}

export default function* watchFetchApplications() {
  yield takeEvery(FETCH_APPLICATIONS, fetchApplications);
  yield takeEvery(LAUNCH_APP, launchApps);
}