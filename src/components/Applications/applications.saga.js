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

function getApplications() {
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

function launchApp(url) {
  return fetch(
    url,
    {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'Accept': 'application/json'
      },
    })
    .then(function (response) {
      return response;
    })
    .catch(function (error) {
      throw error;
    });
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  })
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
    let response = yield call(launchApp, action.url);
    while(response.status != 200) {
      yield call(sleep, 1 * 1000);
      response = yield call(launchApp, action.url)
    }
    yield put(launchAppSuccess(action.address));
    window.open(action.url, '_blank');
  }
  catch (err) {
    yield put(launchAppFailure(err));
  }
}

export default function* watchFetchApplications() {
  yield takeEvery(FETCH_APPLICATIONS, fetchApplications);
  yield takeEvery(LAUNCH_APP, launchApps);
}
