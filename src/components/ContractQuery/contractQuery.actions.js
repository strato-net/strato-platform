export const CLEAR_QUERY_STRING = 'CLEAR_QUERY_STRING';
export const ADD_QUERY_FILTER = 'ADD_QUERY_FILTER';
export const REMOVE_QUERY_FILTER = 'REMOVE_QUERY_FILTER';
export const QUERY_CIRRUS = 'QUERY_CIRRUS';
export const QUERY_CIRRUS_SUCCESS = 'QUERY_CIRRUS_SUCCESS';
export const QUERY_CIRRUS_FAILURE = 'QUERY_CIRRUS_FAILURE';


export const clearQueryString = function() {
  return {
    type: CLEAR_QUERY_STRING
  }
}

export const queryCirrus = function(name, queryString) {
  return {
    type: QUERY_CIRRUS,
    contractName: name,
    queryString: queryString
  };
}

export const queryCirrusSuccess = function(queryResults) {
  return {
    type: QUERY_CIRRUS_SUCCESS,
    queryResults: queryResults,
  }
}

export const queryCirrusFailure = function(error) {
  return {
    type: QUERY_CIRRUS_FAILURE,
    error: error,
  }
}
