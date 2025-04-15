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

export function getContracts(chainid, limit, offset, name) {

  const isAddress = /^0x[a-fA-F0-9]{40}$/.test(searchTerm);

  console.log(isAddress, 'isAddress');

  const queryParam = isAddress
    ? `&address=${searchTerm}`
    : searchTerm
      ? `&name=${searchTerm}`
      : '';

  console.log(queryParam, 'queryParam');
  
  const url = `${contractsUrl}?limit=${limit}&offset=${offset}${chainid ? `&chainid=${chainid}` : ''}${queryParam}`;

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
    let response = yield call(getContracts, action.chainId, action.limit, action.offset, action.name);
    console.log(response, 'response');
    yield put(fetchContractsSuccess(response));
  }
  catch (err) {
    yield put(fetchContractsFailure(err));
  }
}

export default function* watchFetchContracts() {
  yield takeEvery(FETCH_CONTRACTS, fetchContracts);
}
