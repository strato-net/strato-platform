import {
  takeLatest,
  put,
  call
} from 'redux-saga/effects';
import { fetchUploadFailure, FETCH_UPLOAD_LIST, fetchUploadSuccess } from './externalStorage.actions';
import { env } from '../../env';

const url = env.APEX_URL + "/bloc/file/list";

export function fetchUploadList() {
  return fetch(
    url,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    }
  )
    .then(function (response) {
      return response.json();
    })
    .catch(function (error) {
      throw error;
    });
}

export function* fetchUpload(action) {
  try {
    let response = yield call(fetchUploadList);
    yield put(fetchUploadSuccess(response.list))
  }
  catch (err) {
    yield put(fetchUploadFailure(err));
  }
}

export default function* watchFetchUpload() {
  yield takeLatest(FETCH_UPLOAD_LIST, fetchUpload);
}
