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
  if (searchTerm.startsWith("0")) {
    url = `${contractsUrl}/contracts/contract/${searchTerm}?limit=${limit}&offset=${offset}${chainid ? `&chainid=${chainid}` : ""}`;
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
      return response.json();
    })
    .catch(function (error) {
      throw error;
    });
  } 

  else {
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
