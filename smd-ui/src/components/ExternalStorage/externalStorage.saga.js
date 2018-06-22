import {
  takeLatest,
  put,
  call
} from 'redux-saga/effects';
import { fetchUploadFailure, FETCH_UPLOAD_LIST, fetchUploadSuccess } from './externalStorage.actions';
import { env } from '../../env';
import { ATTEST_DOCUMENT_REQUEST, attestDocumentSuccess, attestDocumentFailure } from './Attest/attest.action';
import { verifyDocumentSuccess, verifyDocumentFailure, VERIFY_DOCUMENT_REQUEST } from './Verify/verify.action';

const fetchUploadUrl = env.APEX_URL + "/bloc/file/list";
const attestDocumentUrl = env.APEX_URL + "/bloc/file/attest";
const verifyDocumentUrl = env.APEX_URL + "/bloc/file/verify?contractAddress=:contractAddress";

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

export function* verifyUpload(action) {
  try {
    let response = yield call(verifyDocumentApiCall, action.contractAddress);
    yield put(verifyDocumentSuccess(response));
  }
  catch (err) {
    yield put(verifyDocumentFailure(err));
  }
}

export default function* watchFetchUpload() {
  yield takeLatest(FETCH_UPLOAD_LIST, fetchUpload);
  yield takeLatest(ATTEST_DOCUMENT_REQUEST, attestDocument);
  yield takeLatest(VERIFY_DOCUMENT_REQUEST, verifyUpload);
}
