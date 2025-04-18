import { takeEvery, put, call } from "redux-saga/effects";
import {
  FETCH_CONTRACTS,
  fetchContractsSuccess,
  fetchContractsFailure,
} from "./contracts.actions";
import { env } from "../../env";
import { handleErrors } from "../../lib/handleErrors";

import { 
  selectContractInstance,
  fetchState,
  fetchAccount,
  fetchContractInfoRequest
} from './components/ContractCard/contractCard.actions';

const contractsUrl = env.BLOC_URL + "/contracts";

function isValidContractAddress(address) {
  console.log(address, 'address');
  const regex = /\b[a-fA-F0-9]{40}\b/;
  console.log(regex.test(address), 'address');
  return regex.test(address);
}

async function fetchJson(url) {
  const res = await fetch(url, {
    method: "GET",
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function getContracts(chainid, limit, offset, searchTerm) {
  const params = new URLSearchParams({ limit, offset });

  if (chainid) params.set("chainid", chainid);

  if (searchTerm && isValidContractAddress(searchTerm)) {
    const detailUrl = `${contractsUrl}/contract/${searchTerm}/details?${params}`;
    const { _contractName } = await fetchJson(detailUrl);

    fetchState(_contractName, searchTerm, chainid);
    fetchAccount(_contractName, searchTerm);
    fetchContractInfoRequest(`card-data-${searchTerm}-${chainid}`, _contractName, searchTerm, chainid)
    selectContractInstance(_contractName, searchTerm);
    
    if (_contractName) params.set("name", _contractName);

    const listUrl = `${contractsUrl}?${params}`;
    return fetchJson(listUrl);
  }

  if (searchTerm) params.set("name", searchTerm);

  const listUrl = `${contractsUrl}?${params}`;
  return fetchJson(listUrl);
}

export function* fetchContracts(action) {
  try {
    let response = yield call(
      getContracts,
      action.chainId,
      action.limit,
      action.offset,
      action.name
    );
    yield put(fetchContractsSuccess(response));
  } catch (err) {
    yield put(fetchContractsFailure(err));
  }
}

export default function* watchFetchContracts() {
  yield takeEvery(FETCH_CONTRACTS, fetchContracts);
}
