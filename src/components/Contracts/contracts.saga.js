import {
  takeEvery,
  put,
  call
} from 'redux-saga/effects';
import {
  FETCH_CONTRACTS,
  fetchContractsSuccess,
  fetchContractsFailure
} from './contracts.actions';
import { env } from '../../env';


const contractsUrl = env.BLOC_URL + "/contracts";

function getContracts() {
  return fetch(
    contractsUrl,
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

function* fetchContracts(action) {
  try {
    let response = yield call(getContracts);
    yield put(fetchContractsSuccess(response));
  }
  catch (err) {
    yield put(fetchContractsFailure(err));
  }
}

export default function* watchFetchContracts() {
  yield takeEvery(FETCH_CONTRACTS, fetchContracts);
}
