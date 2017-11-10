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
  let timer;
  try {
    timer = setInterval(function () {
      function* gen() {
        let response = yield call(launchApp, action.url);
        if (response.status === 200) {
          yield put(launchAppSuccess(response.json(), action.url));
          window.open(action.url, "_blank")
          clearTimeout(this);
        }
      }
      gen();
    }, 3000);
  }
  catch (err) {
    clearTimeout(timer);
    yield put(launchAppFailure(err));
  }
}

export default function* watchFetchApplications() {
  yield takeEvery(FETCH_APPLICATIONS, fetchApplications);
  yield takeEvery(LAUNCH_APP, launchApps);
}