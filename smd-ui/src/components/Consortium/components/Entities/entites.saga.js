import {
  takeEvery,
  put,
  call
} from 'redux-saga/effects';
import { FETCH_ENTITES_REQUEST, fetchEntitiesSuccess, fetchEntitiesFailure, INVITE_ENTITY_REQUEST, inviteEntitySuccess, inviteEntityFailure, fetchEntities } from './entities.actions';
import { env } from '../../../../env';

const entitiesUrl = env.APEX_URL + "/entities";
const inviteEntityUrl = env.APEX_URL + "/entities";

export function getEntitiesApi() {
  return fetch(
    entitiesUrl,
    {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      },
    })
    .then(function (response) {
      return response.json()
    })
    .catch(function (error) {
      throw error;
    })
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

export function* getEntites(action) {
  try {
    const response = yield call(getEntitiesApi);
    yield put(fetchEntitiesSuccess(response));
  }
  catch (err) {
    yield put(fetchEntitiesFailure(err));
  }
}


function* makeInviteEntityRequest(action) {
  try {
    let response = yield inviteEntityAPICall(action.entity);
    if (response && response.success) {
      yield put(inviteEntitySuccess(response.success));
      yield put(fetchEntities());
    } else {
      yield put(inviteEntityFailure(response.error.message));
    }
  }
  catch (error) {
    yield put(inviteEntityFailure(error.message));
  }
}

export default function* watchEntitiesActions() {
  yield [
    takeEvery(FETCH_ENTITES_REQUEST, getEntites),
    takeEvery(INVITE_ENTITY_REQUEST, makeInviteEntityRequest)
  ];
}
