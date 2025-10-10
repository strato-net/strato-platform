import { takeEvery, put, call } from "redux-saga/effects";
import {
  FETCH_CONTRACTS,
  FETCH_CONTRACT_INSTANCES,
  fetchContractsSuccess,
  fetchContractsFailure,
  fetchContractInstancesSuccess,
  fetchContractInstancesFailure,
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

export async function getContracts(chainid, limit, offset, searchTerm, instancesPreviewLimit = 10) {
  const params = new URLSearchParams({ limit, offset, instancesPreviewLimit });

  if (chainid) params.set("chainid", chainid);

  // Handle address search
  if (searchTerm && isValidContractAddress(searchTerm)) {
    params.set("address", searchTerm);
  } else if (searchTerm) {
    // Handle name search
    params.set("name", searchTerm);
  }

  const listUrl = `${contractsUrl}?${params}`;
  return fetchJson(listUrl);
}

// New function for fetching contract instances
export async function getContractInstances(contractName, chainid, instOffset = 0, instLimit = 10) {
  const params = new URLSearchParams({ 
    instancesFor: contractName,
    instOffset: instOffset,
    instLimit: instLimit
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
      action.name,
      action.instancesPreviewLimit || 10
    );
    yield put(fetchContractsSuccess(response));
  } catch (err) {
    yield put(fetchContractsFailure(err));
  }
}

// New saga for fetching contract instances
export function* fetchContractInstances(action) {
  try {
    let response = yield call(
      getContractInstances,
      action.contractName,
      action.chainId,
      action.instOffset,
      action.instLimit
    );
    yield put(fetchContractInstancesSuccess(action.contractName, response));
  } catch (err) {
    yield put(fetchContractInstancesFailure(action.contractName, err));
  }
}

export default function* watchFetchContracts() {
  yield takeEvery(FETCH_CONTRACTS, fetchContracts);
  yield takeEvery(FETCH_CONTRACT_INSTANCES, fetchContractInstances);
}
