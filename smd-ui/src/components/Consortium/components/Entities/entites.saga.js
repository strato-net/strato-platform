import {
  takeEvery,
  put,
  call
} from 'redux-saga/effects';
import { FETCH_ENTITES_REQUEST, fetchEntitiesSuccess, fetchEntitiesFailure } from './entities.actions';
import { env } from '../../../../env';

const entitiesUrl = env.APEX_URL + "/entities";

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

export function* getEntites(action) {
  try {
    const response = yield call(getEntitiesApi);
    yield put(fetchEntitiesSuccess(response));
  }
  catch (err) {
    yield put(fetchEntitiesFailure(err));
  }
}

export default function* watchEntitiesActions() {
  yield [
    takeEvery(FETCH_ENTITES_REQUEST, getEntites)
  ];
}
