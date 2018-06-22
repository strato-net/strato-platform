import {
  takeLatest,
  put,
  call
} from 'redux-saga/effects';
import { fetchUploadFailure, FETCH_UPLOAD_LIST, fetchUploadSuccess } from './externalStorage.actions';
import { env } from '../../env';
import { ATTEST_DOCUMENT_REQUEST, attestDocumentSuccess, attestDocumentFailure } from './Attest/attest.action';

const fetchUploadUrl = env.APEX_URL + "/bloc/file/list";
const attestDocumentUrl = env.APEX_URL + "/bloc/file/attest";

export function fetchUploadList() {
  return fetch(
    fetchUploadUrl,
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

export function attestDocumentApiCall(values) {
  return fetch(
    attestDocumentUrl,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(values)
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

export function* attestDocument(action) {
  try {
    let response = yield call(attestDocumentApiCall, action.values);

    if (response.error) {
      yield put(attestDocumentFailure(response.error.message));
    } else {
      yield put(attestDocumentSuccess(response));
    }
  }
  catch (err) {
    yield put(attestDocumentFailure(err));
  }
}

export default function* watchFetchUpload() {
  yield takeLatest(FETCH_UPLOAD_LIST, fetchUpload);
  yield takeLatest(ATTEST_DOCUMENT_REQUEST, attestDocument);
}
