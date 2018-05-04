import {
  takeEvery,
  put,
  call
} from 'redux-saga/effects';
import {
  CREATE_CONSORTIUM_REQUEST,
  INVITE_ENTITY_REQUEST,
  createConsortiumSuccess,
  createConsortiumFailure,
  inviteEntitySuccess,
  inviteEntityFailure,
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

function* inviteEntityAPICall(consortium) {
  return yield call(todo);
}

function* makeInviteEntityRequest(action) {
  try {
    yield inviteEntityAPICall(action.entity);
    yield put(inviteEntitySuccess(action.entity));
  }
  catch (error) {
    yield put(inviteEntityFailure(error.message));
  }
}

export default function* watchConsoritumActions() {
  yield [
    takeEvery(CREATE_CONSORTIUM_REQUEST, makeNewConsortiumRequest),
    takeEvery(INVITE_ENTITY_REQUEST, makeInviteEntityRequest),
  ];
}
