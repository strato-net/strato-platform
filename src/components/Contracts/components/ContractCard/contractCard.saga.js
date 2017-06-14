import {
  takeEvery,
  put,
  call
} from 'redux-saga/effects';
import {
  FETCH_STATE,
  fetchStateSuccess,
  fetchStateFailure
} from './contractCard.actions';
import {NODES} from '../../../../env.js'

const contractsUrl = NODES[0].BLOC_URL + "/contracts/:contractName/:contractAddress/state";

function getState(contractName, contractAddress) {
  return fetch(
    contractsUrl.replace(":contractName", contractName).replace(":contractAddress", contractAddress),
    {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      },
    })
    .then(function(response) {
      return response.json()
    })
    .catch(function(error) {
      throw error;
    });
}

function* fetchState(action) {
  try {
    let response = yield call(getState, action.name, action.address);
    yield put(fetchStateSuccess(action.name, action.address, response));
  }
  catch (err) {
    yield put(fetchStateFailure(err));
  }
}

export default function* watchFetchState() {
  yield takeEvery(FETCH_STATE, fetchState);
}
