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
import { handleErrors } from '../../lib/handleErrors';

const contractsUrl = env.BLOC_URL + "/contracts";

export function getContracts(chainid, limit, offset) {
  const url = `${contractsUrl}?limit=${limit}&offset=${offset}${chainid ? `&chainId=${chainid}` : ''}`

  return fetch(
    url,
    {
      method: 'GET',
      credentials: "include",
      headers: {
        'Accept': 'application/json'
      },
    })
    .then(handleErrors)
    .then(function (response) {
      return response.json()
    })
    .catch(function (error) {
      throw error;
    });
}

export function* fetchContracts(action) {
  try {
    let response = yield call(getContracts, action.chainId, action.limit, action.offset);
    yield put(fetchContractsSuccess(response));
  }
  catch (err) {
    yield put(fetchContractsFailure(err));
  }
}

export default function* watchFetchContracts() {
  yield takeEvery(FETCH_CONTRACTS, fetchContracts);
}
