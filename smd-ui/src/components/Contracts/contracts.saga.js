import { takeEvery, put, call } from "redux-saga/effects";
import {
  FETCH_CONTRACTS,
  fetchContractsSuccess,
  fetchContractsFailure,
} from "./contracts.actions";
import { env } from "../../env";
import { handleErrors } from "../../lib/handleErrors";

const contractsUrl = env.BLOC_URL + "/contracts";

function isValidContractAddress(address) {
  const regex = /\b[a-fA-F0-9]{40}\b/;
  return regex.test(address);
}

export async function getContracts(chainid, limit, offset, searchTerm) {
  let url;

  if (searchTerm && isValidContractAddress(searchTerm)) {

    url = `${contractsUrl}/contract/${searchTerm}/details/${chainid ? `?chainid=${chainid}` : ""}`;

    try {
      const response = await fetch(url, {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      const { _contractName } = data;

      const nextUrl = `${contractsUrl}?limit=${limit}&offset=${offset}${chainid ? `&chainid=${chainid}` : ""}${_contractName ? `&name=${_contractName}` : ""}`;

      const nextResponse = await fetch(nextUrl, {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json" },
      });

      if (!nextResponse.ok) {
        throw new Error(`HTTP error! status: ${nextResponse.status}`);
      }

      return await nextResponse.json();
    } catch (error) {
      handleErrors(error);
      throw error;
    }
  } else {
    url = `${contractsUrl}?limit=${limit}&offset=${offset}${chainid ? `&chainid=${chainid}` : ""}${searchTerm ? `&name=${searchTerm}` : ""}`;

    try {
      const response = await fetch(url, {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      handleErrors(error);
      throw error;
    }
  }
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
    console.log(response, "response");
    yield put(fetchContractsSuccess(response));
  } catch (err) {
    yield put(fetchContractsFailure(err));
  }
}

export default function* watchFetchContracts() {
  yield takeEvery(FETCH_CONTRACTS, fetchContracts);
}
