import {
  takeEvery,
  put,
  call
} from 'redux-saga/effects';
import {
  FETCH_DIFFICULTY,
  fetchDifficultySuccess,
  fetchDifficultyFailure
} from './difficulty.actions';

const url = "http://strato-int.centralus.cloudapp.azure.com/strato-api/eth/v1.2/block/last/0"
//FIXME hard coded api url

function getDifficulty() {
  return fetch(
    url,
    {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
    },
  })
    .then(function(response) {
      return response.json()
    })
    .then(function(res) {
      return res[0].blockData.difficulty;
    })
    .catch(function(error) {
      throw error;
    });
}

function* fetchDifficulty(action) {
  try {
    let response = yield call(getDifficulty);
    yield put(fetchDifficultySuccess(response));
  }
  catch (err) {
    yield put(fetchDifficultyFailure(err));
  }
}

export default function* watchFetchDifficulty() {
  yield takeEvery(FETCH_DIFFICULTY, fetchDifficulty);
}
