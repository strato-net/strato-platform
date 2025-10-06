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

export async function getContracts(chainid, limit, offset, searchTerm, instanceOffset, instanceLimit) {
  const params = new URLSearchParams({ limit, offset });

  if (chainid) params.set("chainid", chainid);
  if (searchTerm) params.set("name", searchTerm);
  if (instanceOffset !== undefined) params.set("instanceOffset", instanceOffset);
  if (instanceLimit !== undefined) params.set("instanceLimit", instanceLimit);

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
      action.instanceOffset,
      action.instanceLimit
    );
    yield put(fetchContractsSuccess(response));
  } catch (err) {
    yield put(fetchContractsFailure(err));
  }
}

export default function* watchFetchContracts() {
  yield takeEvery(FETCH_CONTRACTS, fetchContracts);
}
