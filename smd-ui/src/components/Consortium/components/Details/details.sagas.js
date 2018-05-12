import {
  takeEvery,
  put
} from 'redux-saga/effects';
import { FETCH_ENTITY_REQUEST, fetchEntitySuccess, fetchEntityFailure } from './details.actions';
import { env } from '../../../../env';

const entityUrl = env.APEX_URL + "/entities/:id";

function getEntity(id) {
  return fetch(
    entityUrl.replace(':id', id),
    {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    })
    .then(function (response) {
      return response.json()
    })
    .catch(function (error) {
      throw error;
    })
}

function* fetchEntityRequest(action) {
  try {
    let response = yield getEntity(action.id);
    yield put(fetchEntitySuccess(response));
  }
  catch (error) {
    yield put(fetchEntityFailure(error.message));
  }
}

export default function* watchDetailsActions() {
  yield [
    takeEvery(FETCH_ENTITY_REQUEST, fetchEntityRequest)
  ];
}
