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

export function getContracts(chainId) {
  let localContractsUrl = contractsUrl;
  if (chainId) {
    localContractsUrl += `?chainid=${chainId}`
  }
  return fetch(
    localContractsUrl,
    {
      method: 'GET',
      credentials: "include",
      headers: {
        'Accept': 'application/json'
      },
    })
    .then(function (response) {
      return response.json()
    })
    .catch(function (error) {
      throw error;
    });
}

export function* fetchContracts(action) {
  try {
    let response = yield call(getContracts, action.chainId);
    yield put(fetchContractsSuccess(response));
  }
  catch (err) {
    yield put(fetchContractsFailure(err));
  }
}

export default function* watchFetchContracts() {
  yield takeEvery(FETCH_CONTRACTS, fetchContracts);
}
