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
// import { handleApiError } from '../../lib/apiErrorHandler';
import { env } from '../../env';

const url = env.APEX_URL + '/dapps';

function uploadAppCall(username, userAddress, password, files) {
  const body = new FormData();
  body.append('username', username);
  body.append('address', userAddress);
  body.append('password', password);
  body.append('file', files[0]);

  return fetch(
    url,
    {
      method: 'POST',
      body: body
    }
  )
  .then((res) => {
    return res.json();
  })
  // .then(handleApiError)
  .catch((err) => {
    throw err;
  })
}

function* uploadApp(action) {
  try {
    yield call(
      uploadAppCall,
      action.formData.appUsername,
      action.formData.appUserAddress,
      action.formData.appPassword,
      action.formData.appPackage
    );
    yield put(appUploadSuccess());
  } catch(err) {
    yield put(appUploadFailure(err.message));
  }
}

export default function* watchAppUpload() {
  yield takeLatest(APP_UPLOAD_REQUEST, uploadApp)
}
