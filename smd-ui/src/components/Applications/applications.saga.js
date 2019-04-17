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
import { handleErrors } from '../../lib/handleErrors';

const applicationsUrl = env.CIRRUS_URL + '/AppMetadata';

export function getApplications() {
  return fetch(
    applicationsUrl,
    {
      method: 'GET',
      credentials: "include",
      headers: {
        'Accept': 'application/json'
      },
    })
    .then(handleErrors)
    .then(function (response) {
      return response.json()
    })
    .catch(function (error) {
      throw error;
    });
}

export function launchApp(url) {
  return fetch(
    url,
    {
      method: 'GET',
      credentials: "include",
      redirect: 'follow',
      headers: {
        'Accept': 'application/json'
      },
    })
    .then(handleErrors)
    .then(function (response) {
      return response;
    })
    .catch(function (error) {
      throw error;
    });
}

export function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  })
}


export function* fetchApplications(action) {
  try {
    let response = yield call(getApplications);
    yield put(fetchApplicationsSuccess(response));
  }
  catch (err) {
    yield put(fetchApplicationsFailure(err));
  }
}

export function* launchApps(action) {
  try {
    let response = yield call(launchApp, action.url);
    const retriesTotal = 7;
    let retriesLeft = retriesTotal;
    while(response.status !== 200) {
      yield call(sleep, retriesTotal/retriesLeft * 1000);
      response = yield call(launchApp, action.url);
      retriesLeft -= 1;
      if (retriesLeft === 0) break;
    }
    if (response.status && response.status === 200) {
      yield put(launchAppSuccess(action.address));
      window.open(action.url, '_blank');
    } else {
      throw Error('Timeout on app fetching');
    }
  }
  catch (err) {
    yield put(launchAppFailure(err));
  }
}

export default function* watchFetchApplications() {
  yield takeEvery(FETCH_APPLICATIONS, fetchApplications);
  yield takeEvery(LAUNCH_APP, launchApps);
}
