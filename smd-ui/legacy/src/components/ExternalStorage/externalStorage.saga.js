import {
  takeLatest,
  put,
  call
} from 'redux-saga/effects';
import { fetchUploadFailure, FETCH_UPLOAD_LIST, fetchUploadSuccess } from './externalStorage.actions';
import { env } from '../../env';
import { ATTEST_DOCUMENT_REQUEST, attestDocumentSuccess, attestDocumentFailure } from './Attest/attest.actions';
import { verifyDocumentSuccess, verifyDocumentFailure, VERIFY_DOCUMENT_REQUEST } from './Verify/verify.actions';
import { DOWNLOAD_REQUEST, downloadSuccess, downloadFailure } from './Download/download.actions';
import { handleErrors } from '../../lib/handleErrors';

const fetchUploadUrl = env.APEX_URL + "/bloc/file/list";
const attestDocumentUrl = env.APEX_URL + "/bloc/file/attest";
const verifyDocumentUrl = env.APEX_URL + "/bloc/file/verify?contractAddress=:contractAddress";
const downloadUrl = env.APEX_URL + "/bloc/file/download?contractAddress=:contractAddress";

export function fetchUploadListApiCall() {
  return fetch(
    fetchUploadUrl,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    }
  )
    .then(handleErrors)
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
    .then(handleErrors)
    .then(function (response) {
      return response.json();
    })
    .catch(function (error) {
      throw error;
    });
}

export function verifyDocumentApiCall(contractAddress) {
  return fetch(
    verifyDocumentUrl.replace(':contractAddress', contractAddress),
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    }
  )
    .then(handleErrors)
    .then(function (response) {
      return response.json();
    })
    .catch(function (error) {
      throw error;
    });
}

export function* fetchUpload(action) {
  try {
    let response = yield call(fetchUploadListApiCall);
    yield put(fetchUploadSuccess(response.list))
  }
  catch (err) {
    yield put(fetchUploadFailure(err));
  }
}

export function downloadApiCall(contractAddress) {
  return fetch(
    downloadUrl.replace(':contractAddress', contractAddress),
    {
      method: 'GET'
    }
  )
    .then(function (response) {
      return response.json();
    })
    .catch(function (error) {
      throw error;
    });
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

export function* verifyUpload(action) {
  try {
    let response = yield call(verifyDocumentApiCall, action.contractAddress);
    if (response.error) {
      yield put(verifyDocumentFailure(response.error.message));
    } else {
      yield put(verifyDocumentSuccess(response));
    }
  }
  catch (err) {
    yield put(verifyDocumentFailure(err));
  }
}

export function* download(action) {
  try {
    let response = yield call(downloadApiCall, action.contractAddress);

    if (response.url) {
      yield put(downloadSuccess(response.url));
    } else {
      yield put(downloadFailure(response.error.message));
    }
  }
  catch (err) {
    yield put(downloadFailure(err));
  }
}

export default function* watchFetchUpload() {
  yield takeLatest(FETCH_UPLOAD_LIST, fetchUpload);
  yield takeLatest(ATTEST_DOCUMENT_REQUEST, attestDocument);
  yield takeLatest(VERIFY_DOCUMENT_REQUEST, verifyUpload);
  yield takeLatest(DOWNLOAD_REQUEST, download);
}
