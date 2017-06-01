import {
  takeEvery,
  put,
  call
} from 'redux-saga/effects';
import {
  FETCH_BLOCK_DATA,
  fetchBlockDataSuccess,
  fetchBlockDataFailure
} from './block-data.actions';

const url = "http://bayar6.eastus.cloudapp.azure.com/strato-api/eth/v1.2/block/last/0"; //FIXME hard coded api url
/*const url = APIURL + "/strato-api/eth/v1.2/block/last/0" */ 

function getBlockData() {
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
      return res[0].blockData;
    })
    .catch(function(error) {
      throw error;
    });
}

function* fetchBlockData(action) {
  try {
    let response = yield call(getBlockData);
    yield put(fetchBlockDataSuccess(response));
  }
  catch (err) {
    yield put(fetchBlockDataFailure(err));
  }
}

export default function* watchFetchBlockData() {
  yield takeEvery(FETCH_BLOCK_DATA, fetchBlockData);
}
