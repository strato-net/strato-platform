export const SEARCH_QUERY_REQUEST = 'SEARCH_QUERY_REQUEST';
export const SEARCH_QUERY_SUCCESS = 'SEARCH_QUERY_SUCCESS';

export const searchQueryRequest = function (searchQuery) {
    return {
      type: SEARCH_QUERY_REQUEST,
      searchQuery
    }
  };

  export const searchQuerySuccess = function (searchResult) {
    return {
      type: SEARCH_QUERY_SUCCESS,
      searchResult
    }
  };
