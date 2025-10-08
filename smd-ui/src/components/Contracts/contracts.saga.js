import { takeEvery, put, call } from "redux-saga/effects";
import {
  FETCH_CONTRACTS,
  FETCH_CONTRACTS_WITH_PREVIEW,
  LOAD_MORE_CONTRACTS,
  LOAD_MORE_INSTANCES,
  fetchContractsSuccess,
  fetchContractsFailure,
  fetchContractsWithPreviewSuccess,
  fetchContractsWithPreviewFailed,
  loadMoreContractsSuccess,
  loadMoreInstancesSuccess,
  loadMoreInstancesFailed
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
  const regex = /\b[a-fA-F0-9]{40}\b/;
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

  // if (searchTerm && isValidContractAddress(searchTerm)) {
  //   const detailUrl = `${contractsUrl}/contract/${searchTerm}/details?${params}`;
  //   const { _contractName } = await fetchJson(detailUrl);
    
  //   if (_contractName) params.set("name", searchTerm);

  //   const listUrl = `${contractsUrl}?${params}`;
  //   return fetchJson(listUrl);
  // }

  if (searchTerm) params.set("name", searchTerm);

  const listUrl = `${contractsUrl}?${params}`;
  return fetchJson(listUrl);
}

// New API functions for progressive loading
export async function getContractsWithPreview(chainid, limit, offset, searchTerm, address, instancesPreviewLimit) {
  const params = new URLSearchParams({ 
    limit, 
    offset, 
    instancesPreviewLimit: instancesPreviewLimit || 10 
  });

  if (chainid) params.set("chainid", chainid);
  if (searchTerm) params.set("name", searchTerm);
  if (address) params.set("address", address);

  const listUrl = `${contractsUrl}?${params}`;
  return fetchJson(listUrl);
}

export async function getContractInstances(contractName, instOffset, instLimit, chainid) {
  const params = new URLSearchParams({ 
    instancesFor: contractName,
    instOffset: instOffset || 0,
    instLimit: instLimit || 10
  });

  if (chainid) params.set("chainid", chainid);

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

// New saga handlers for progressive loading
export function* fetchContractsWithPreview(action) {
  try {
    let response = yield call(
      getContractsWithPreview,
      action.chainId,
      action.limit,
      action.offset,
      action.name,
      action.address,
      action.instancesPreviewLimit
    );
    yield put(fetchContractsWithPreviewSuccess(response));
  } catch (err) {
    yield put(fetchContractsWithPreviewFailed(err));
  }
}

export function* loadMoreContracts(action) {
  try {
    let response = yield call(
      getContractsWithPreview,
      action.chainId,
      action.limit,
      action.offset,
      action.name,
      null, // no address for load more
      action.instancesPreviewLimit
    );
    yield put(loadMoreContractsSuccess(response));
  } catch (err) {
    yield put(fetchContractsWithPreviewFailed(err));
  }
}

export function* loadMoreInstances(action) {
  try {
    let response = yield call(
      getContractInstances,
      action.contractName,
      action.instOffset,
      action.instLimit,
      action.chainId
    );
    yield put(loadMoreInstancesSuccess(action.contractName, response.items, response.next));
  } catch (err) {
    yield put(loadMoreInstancesFailed(action.contractName, err));
  }
}

export default function* watchFetchContracts() {
  yield takeEvery(FETCH_CONTRACTS, fetchContracts);
  yield takeEvery(FETCH_CONTRACTS_WITH_PREVIEW, fetchContractsWithPreview);
  yield takeEvery(LOAD_MORE_CONTRACTS, loadMoreContracts);
  yield takeEvery(LOAD_MORE_INSTANCES, loadMoreInstances);
}
