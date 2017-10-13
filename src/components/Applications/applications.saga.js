import {
  takeEvery,
  put,
  call
} from 'redux-saga/effects';
import {
  FETCH_APPLICATIONS,
  fetchApplicationsSuccess,
  fetchApplicationsFailure
} from './applications.actions';

// removed app.json json file when actual API is implemented 
const applications = require('../../mock_apps/apps.json');

// const applicationsUrl = '/apps';

function getApplications() {
  return applications;
  // return fetch(
  //   applicationsUrl,
  //   {
  //     method: 'GET',
  //     headers: {
  //       'Accept': 'application/json'
  //   },
  // })
  // .then(function(response) {
  //   return response.json()
  // })
  // .catch(function(error) {
  //   throw error;
  // });
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

export default function* watchFetchApplications() {
  yield takeEvery(FETCH_APPLICATIONS, fetchApplications);
}
