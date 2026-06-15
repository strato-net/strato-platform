import {
  takeLatest,
  put,
  call
} from 'redux-saga/effects';
import { UPLOAD_FILE_REQUEST, uploadFileSuccess, uploadFileFailure } from './uploadFile.actions';
import { env } from '../../../env';
import { fetchUploadList } from '../externalStorage.actions';
import { handleErrors } from '../../../lib/handleErrors';

const url = env.APEX_URL + "/bloc/file/upload";

export function uploadFileApiCall(data) {

  let formData = new FormData();

  formData.append('username', data.username);
  formData.append('password', data.password);
  formData.append('address', data.address);
  formData.append('content', data.file);
  formData.append('provider', data.provider);
  formData.append('metadata', data.description);

  return fetch(
    url,
    {
      method: 'POST',
      body: formData
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

export function* uploadFile(action) {
  try {
    let response = yield call(uploadFileApiCall, action.data);
    if (response.error) {
      yield put(uploadFileFailure(response.error.message));
    } else {
      yield put(uploadFileSuccess(response));
      yield put(fetchUploadList());
    }
  }
  catch (err) {
    yield put(uploadFileFailure(err));
  }
}

export default function* watchUploadFile() {
  yield takeLatest(UPLOAD_FILE_REQUEST, uploadFile);
}
