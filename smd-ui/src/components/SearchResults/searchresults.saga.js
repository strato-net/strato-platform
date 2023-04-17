import {
    put,
    call,
    takeLatest
  } from 'redux-saga/effects';
import {
    SEARCH_QUERY_REQUEST,
    SEARCH_QUERY_SUCCESS,
    SEARCH_QUERY_FAILURE,
    searchQueryRequest,
    searchQuerySuccess,
    searchQueryFailure,
  } from './searchresults.actions';
import { env } from '../../env';
import { handleErrors } from '../../lib/handleErrors';


export function searchQueryApi(searchQuery) {
  const cirrusUrl = env.CIRRUS_URL + "/Certificate?or=(commonName.ilike.*" + searchQuery + "*" + ",organization.ilike.*" + searchQuery + "*" + ",userAddress.ilike.*" + searchQuery + "*)";

  return fetch (cirrusUrl,
    {
      method: 'GET',
      credentials: "include",
      headers: {
        'Accept': 'application/json'
      },
    }
  )
    .then(handleErrors)
    .then(function (response) {
      return response.json();
    })
    .catch(function (error) {
      throw error;
    })
}

export function* getsearchQuery(action) {
    try {
      const response = yield call(searchQueryApi, action.searchQuery);
      yield put(searchQuerySuccess(response));
    }
    catch (err) {
      yield put(searchQueryFailure(err));
    }
  }

export default function* watchSearchQuery() {
    yield [
        takeLatest(SEARCH_QUERY_REQUEST, getsearchQuery)
    ];}