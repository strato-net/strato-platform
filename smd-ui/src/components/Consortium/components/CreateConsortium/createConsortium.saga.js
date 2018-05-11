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
import { env } from '../../../../env';

const inviteEntityUrl = env.APEX_URL + "/entities";

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

function inviteEntityAPICall(entity) {
  return fetch(
    inviteEntityUrl,
    {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        adminEmail: entity.adminEmail,
        adminEthereumAddress: entity.adminEthereumAddress,
        adminName: entity.adminName,
        enodeUrl: entity.eNodeUrl,
        name: entity.name,
        tokenAmount: entity.tokenAmount
      })
    })
    .then(function (response) {
      return response.json()
    })
    .catch(function (error) {
      throw error;
    })
}

function* makeInviteEntityRequest(action) {
  try {
    let response = yield inviteEntityAPICall(action.entity);
    yield put(inviteEntitySuccess(response));
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
