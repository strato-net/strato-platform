export const SEARCH_QUERY_REQUEST = 'SEARCH_QUERY_REQUEST';
export const SEARCH_QUERY_SUCCESS = 'SEARCH_QUERY_SUCCESS';
export const SEARCH_QUERY_FAILURE = 'SEARCH_QUERY_FAILURE';

export const searchQueryRequest = function (searchQuery) {
    return {
      type: SEARCH_QUERY_REQUEST,
      searchQuery
    }
  };

export const searchQuerySuccess = function (searchResults) {
  return {
    type: SEARCH_QUERY_SUCCESS,
    searchResults
  }
};
export const searchQueryFailure = function (error) {
  return {
    type: SEARCH_QUERY_FAILURE,
    error
  }
};
