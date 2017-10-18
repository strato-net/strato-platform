import {
  takeLatest,
  put,
  call
} from 'redux-saga/effects';
import {
  APP_UPLOAD_REQUEST,
  appUploadSuccess,
  appUploadFailure
} from './launchPad.actions';

const url = '';

function* uploadApp(action) {
  try {
    // TODO: network request
    yield put(appUploadSuccess());
  } catch(err) {
    yield put(appUploadFailure(err));
  }
}

export default function* watchAppUpload() {
  yield takeLatest(APP_UPLOAD_REQUEST, uploadApp)
}
