import {
  takeEvery,
  put,
  call
} from 'redux-saga/effects';
import {
  CREATE_CONSORTIUM_REQUEST,
  createConsortiumSuccess,
  createConsortiumFailure,
} from './createConsortium.actions';

function todo() {
  new Promise(function (resolve, reject) {
    setTimeout(resolve, 2000, true);
  })
}

function* newConsortiumAPICall(consortium) {
  return yield call(todo);
}

function* makeNewConsortiumRequest(action) {
  try {
    yield newConsortiumAPICall(action.consortium);
    yield put(createConsortiumSuccess(action.consortium));
  }
  catch (error) {
    yield put(createConsortiumFailure(error.message));
  }
}

export default function* watchCreateConsoritumRequest() {
  yield takeEvery(CREATE_CONSORTIUM_REQUEST, makeNewConsortiumRequest);
}
