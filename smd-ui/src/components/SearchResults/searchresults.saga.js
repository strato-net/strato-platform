import {
    put,
    call,
    takeEvery
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
import { createUrl } from '../../lib/url';

export function searchQueryApi(searchQuery) {
  const cirrusUrl = env.CIRRUS_URL + "/Certificate?commonName=ilike.*" + searchQuery + "*";
  fetch (cirrusUrl,
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
    // yield put(searchQuerySuccess(action.searchQuery));
    //apex?
    try {
      const response = yield call(searchQueryApi, action.searchQuery);
      // const response = ["999"];
      yield put(searchQuerySuccess(response));
    }
    catch (err) {
      yield put(searchQueryFailure(err));
    }
  }

export default function* watchSearchQuery() {
    yield [
        takeEvery(SEARCH_QUERY_REQUEST, getsearchQuery)
    ];}