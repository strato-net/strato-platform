import { takeEvery, put, call } from "redux-saga/effects";
import {
  FETCH_CONTRACTS,
  fetchContractsSuccess,
  fetchContractsFailure,
} from "./contracts.actions";
import { env } from "../../env";
import { handleErrors } from "../../lib/handleErrors";

const contractsUrl = env.BLOC_URL + "/contracts";

export function getContracts(chainid, limit, offset, searchTerm) {
  let url;

  if (searchTerm && searchTerm.startsWith("00")) {
    // First, fetch the contract detail using address/hash
    url = `${contractsUrl}/contract/${searchTerm}${chainid ? `&chainid=${chainid}` : ""}`;
    return fetch(url, {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "application/json",
      },
    })
    .then(handleErrors)
    .then(function (response) {
      console.log(response, 'response');
      const { _contractName } = response;

      // Then, use the name from that response to make another fetch call
      const nextUrl = `${contractsUrl}?limit=${limit}&offset=${offset}${chainid ? `&chainid=${chainid}` : ""}${_contractName ? `&name=${_contractName}` : ""}`;
      return fetch(nextUrl, {
        method: "GET",
        credentials: "include",
        headers: {
          Accept: "application/json",
        },
      });
    })
    .then(handleErrors)
    .then(function (response) {
      return response.json();
    })
    .catch(function (error) {
      throw error;
    });

  } else {
    url = `${contractsUrl}?limit=${limit}&offset=${offset}${chainid ? `&chainid=${chainid}` : ""}${searchTerm ? `&name=${searchTerm}` : ""}`;
    return fetch(url, {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "application/json",
      },
    })
    .then(handleErrors)
    .then(function (response) {
      return response.json();
    })
    .catch(function (error) {
      throw error;
    });
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
