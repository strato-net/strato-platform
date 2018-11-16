export const UPDATE_QUERY = 'UPDATE_QUERY';
export const EXECUTE_QUERY_REQUEST = 'EXECUTE_QUERY_REQUEST';
export const EXECUTE_QUERY_SUCCESS = 'EXECUTE_QUERY_SUCCESS';
export const EXECUTE_QUERY_FAILURE = 'EXECUTE_QUERY_FAILURE';
export const CLEAR_QUERY = 'CLEAR_QUERY';
export const REMOVE_QUERY = 'REMOVE_QUERY';

export const updateQuery = function (queryType, queryTerm) {
  return {
    type: UPDATE_QUERY,
    queryType: queryType,
    queryTerm: queryTerm
  }
};

export const removeQuery = function(queryType) {
  return {
    type: REMOVE_QUERY,
    queryType: queryType,
  }
}

export const executeQuery = function(resourceType, query, chainId) {
  return {
    type: EXECUTE_QUERY_REQUEST,
    resourceType: resourceType,
    query: query,
    chainId: chainId
  }
};

export const executeQuerySuccess = function(queryResult) {
  return {
    type: EXECUTE_QUERY_SUCCESS,
    queryResult: queryResult
  }
};

export const executeQueryFailure = function(error) {
  return {
    type: EXECUTE_QUERY_FAILURE,
    error: error
  }
};

export const clearQuery = function() {
  return {
    type: CLEAR_QUERY
  }
};
