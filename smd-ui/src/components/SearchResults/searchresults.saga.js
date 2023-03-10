import {
    put,
    call,
    takeEvery
  } from 'redux-saga/effects';
import {
    SEARCH_QUERY_REQUEST,
    SEARCH_QUERY_SUCCESS,
    searchQueryRequest,
    searchQuerySuccess,
  } from './searchresults.actions';
import { env } from '../../env';
import { handleErrors } from '../../lib/handleErrors';
import { createUrl } from '../../lib/url';

export function searchQueryApi(searchQuery) {
    return searchQuery
}

export function* getsearchQuery(action) {
    yield put(searchQuerySuccess(action.searchQuery));
    //apex?
  }

export default function* watchSearchQuery() {
    yield [
        takeEvery(SEARCH_QUERY_SUCCESS, getsearchQuery)
    ];}