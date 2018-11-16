export const CLEAR_QUERY_STRING = 'CLEAR_QUERY_STRING';
export const ADD_QUERY_FILTER = 'ADD_QUERY_FILTER';
export const REMOVE_QUERY_FILTER = 'REMOVE_QUERY_FILTER';
export const QUERY_CIRRUS_REQUEST = 'QUERY_CIRRUS_REQUEST';
export const QUERY_CIRRUS_SUCCESS = 'QUERY_CIRRUS_SUCCESS';
export const QUERY_CIRRUS_FAILURE = 'QUERY_CIRRUS_FAILURE';
export const QUERY_CIRRUS_VARS_REQUEST = 'QUERY_CIRRUS_VARS_REQUEST';
export const QUERY_CIRRUS_VARS_SUCCESS = 'QUERY_CIRRUS_VARS_SUCCESS';
export const QUERY_CIRRUS_VARS_FAILURE = 'QUERY_CIRRUS_VARS_FAILURE';

export const queryCirrusVars = function (contractName) {
  return {
    type: QUERY_CIRRUS_VARS_REQUEST,
    contractName
  }
}

export const queryCirrusVarsSuccess = function (vars) {
  return {
    type: QUERY_CIRRUS_VARS_SUCCESS,
    vars: vars
  }
}

export const queryCirrusVarsFailure = function (error) {
  return {
    type: QUERY_CIRRUS_VARS_FAILURE,
    error: error
  }
}

export const clearQueryString = function () {
  return {
    type: CLEAR_QUERY_STRING
  }
}

export const queryCirrus = function (name, queryString, chainId) {
  return {
    type: QUERY_CIRRUS_REQUEST,
    contractName: name,
    queryString: queryString,
    chainId: chainId
  };
}

export const queryCirrusSuccess = function (queryResults) {
  return {
    type: QUERY_CIRRUS_SUCCESS,
    queryResults: queryResults,
  }
}

export const queryCirrusFailure = function (error) {
  return {
    type: QUERY_CIRRUS_FAILURE,
    error: error,
  }
}

export const addQueryFilter = function (field, operator, value) {
  return {
    type: ADD_QUERY_FILTER,
    field,
    operator,
    value
  }
}

export const removeQueryFilter = function (tagIndex) {
  return {
    type: REMOVE_QUERY_FILTER,
    index: tagIndex
  }
}
